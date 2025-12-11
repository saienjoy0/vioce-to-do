import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { addDays, format, isSameDay, startOfWeek } from 'date-fns';
import { ja } from 'date-fns/locale';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

LocaleConfig.locales['ja'] = {
  monthNames: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  monthNamesShort: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  dayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  dayNamesShort: ['日', '月', '火', '水', '木', '金', '土'],
  today: '今日'
};
LocaleConfig.defaultLocale = 'ja';

const HOUR_HEIGHT = 80; 
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Task = {
  id: string;
  title: string;
  description?: string;
  time?: string | null;
  date?: string;
  notificationId?: string | null;
};

export default function ScheduleScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [sliderValue, setSliderValue] = useState<number>(540); 
  const [isTimeActive, setIsTimeActive] = useState(false); 

  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function register() {
      if (Device.isDevice) {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') await Notifications.requestPermissionsAsync();
      }
    }
    register();
  }, []);

  const loadTasks = async () => {
    try {
      const jsonValue = await AsyncStorage.getItem('my-voice-tasks');
      if (jsonValue != null) {
        const loadedTasks: Task[] = JSON.parse(jsonValue);
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const patchedTasks = loadedTasks.map(t => ({
          ...t,
          date: t.date || todayStr,
          description: t.description || ''
        }));
        setTasks(patchedTasks);
      }
    } catch (e) { console.error(e); }
  };

  useFocusEffect(
    useCallback(() => {
      loadTasks();
      const timer = setInterval(() => setCurrentTime(new Date()), 60000);
      return () => clearInterval(timer);
    }, [])
  );

  useEffect(() => {
    if (viewMode === 'week') {
      setTimeout(() => {
        if (scrollViewRef.current) {
          const currentHour = new Date().getHours();
          const targetHour = Math.max(0, currentHour - 1);
          scrollViewRef.current.scrollTo({ y: targetHour * HOUR_HEIGHT, animated: true });
        }
      }, 100);
    }
  }, [viewMode]);

  const jumpToToday = () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    setSelectedDate(today);
    setViewMode('week');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ★変更: ゆったりダブルタップ判定
  const handleDateTap = (dateStr: string) => {
    // 既に選択されている日付をもう一度タップしたら「決定（週表示へ）」
    if (selectedDate === dateStr) {
      setViewMode('week');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      // 違う日付なら、まずは「選択」だけする
      setSelectedDate(dateStr);
      Haptics.selectionAsync();
    }
  };

  const openEditModal = (task: Task) => {
    setSelectedTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    
    if (task.time) {
      setIsTimeActive(true);
      const [h, m] = task.time.split(':').map(Number);
      setSliderValue(h * 60 + (m || 0));
    } else {
      setIsTimeActive(false);
      setSliderValue(540); 
    }
    
    setModalVisible(true);
    Haptics.selectionAsync();
  };

  const formatMinutesToTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  const saveTaskChanges = async () => {
    if (!selectedTask) return;

    const newTimeStr = isTimeActive ? formatMinutesToTime(sliderValue) : null;

    let notifId = selectedTask.notificationId;
    if (newTimeStr !== selectedTask.time) {
      if (notifId) await Notifications.cancelScheduledNotificationAsync(notifId);
      if (newTimeStr) {
        const [h, m] = newTimeStr.split(':').map(Number);
        const triggerDate = new Date(selectedTask.date || selectedDate);
        triggerDate.setHours(h, m || 0, 0, 0);
        if (triggerDate > new Date()) {
           notifId = await Notifications.scheduleNotificationAsync({
            content: { title: "時間です！", body: editTitle, sound: true },
            trigger: triggerDate,
          });
        }
      } else {
        notifId = null;
      }
    }

    const newTasks = tasks.map(t => {
      if (t.id === selectedTask.id) {
        return { 
          ...t, 
          title: editTitle, 
          description: editDesc, 
          time: newTimeStr, 
          notificationId: notifId 
        };
      }
      return t;
    });

    setTasks(newTasks);
    await AsyncStorage.setItem('my-voice-tasks', JSON.stringify(newTasks));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setModalVisible(false);
    setSelectedTask(null);
  };

  const deleteTask = async () => {
    if (!selectedTask) return;
    if (selectedTask.notificationId) await Notifications.cancelScheduledNotificationAsync(selectedTask.notificationId);
    const newTasks = tasks.filter(t => t.id !== selectedTask.id);
    setTasks(newTasks);
    await AsyncStorage.setItem('my-voice-tasks', JSON.stringify(newTasks));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setModalVisible(false);
    setSelectedTask(null);
  };

  const currentDayTasks = useMemo(() => tasks.filter(t => t.date === selectedDate), [tasks, selectedDate]);
  const unscheduledTasks = currentDayTasks.filter(t => !t.time);
  const getTasksForHour = (hour: number) => {
    return currentDayTasks.filter(t => {
      if (!t.time) return false;
      const taskHour = parseInt(t.time.split(':')[0], 10);
      return taskHour === hour;
    });
  };
  const digestTasks = useMemo(() => {
    return [...currentDayTasks].sort((a, b) => {
      if (!a.time) return -1;
      if (!b.time) return 1;
      return parseInt(a.time) - parseInt(b.time);
    });
  }, [currentDayTasks]);

  const calendarMarks = useMemo(() => {
    return tasks.reduce((acc, t) => {
      if(t.date) {
        const color = t.time ? '#3498db' : '#e57373';
        const existing = acc[t.date];
        const finalColor = (existing?.dotColor === '#e57373' || color === '#e57373') ? '#e57373' : '#3498db';
        acc[t.date] = { marked: true, dotColor: finalColor };
      }
      return acc;
    }, {} as any);
  }, [tasks]);

  const renderCurrentTimeLine = (hour: number) => {
    if (!isSameDay(new Date(selectedDate), new Date())) return null;
    const currentHour = currentTime.getHours();
    if (currentHour !== hour) return null;
    const currentMinute = currentTime.getMinutes();
    const topPosition = (currentMinute / 60) * HOUR_HEIGHT;
    return (
      <View style={[styles.currentTimeLine, { top: topPosition }]}>
        <View style={styles.currentTimeDot} />
      </View>
    );
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(new Date(selectedDate), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      return {
        date, dateStr,
        dayLabel: format(date, 'E', { locale: ja }),
        dayNum: format(date, 'd'),
        isSelected: dateStr === selectedDate,
        isToday: isSameDay(date, new Date()),
        hasTask: tasks.some(t => t.date === dateStr)
      };
    });
  }, [selectedDate, tasks]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
          <Text style={styles.headerTitle}>{format(new Date(selectedDate), 'M月d日 (E)', { locale: ja })}</Text>
          {!isSameDay(new Date(selectedDate), new Date()) && (
            <TouchableOpacity onPress={jumpToToday} style={styles.todayButton}><Text style={styles.todayButtonText}>今日</Text></TouchableOpacity>
          )}
        </View>
        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tabButton, viewMode === 'week' && styles.activeTab]} onPress={() => setViewMode('week')}>
            <Text style={[styles.tabText, viewMode === 'week' && styles.activeTabText]}>週</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabButton, viewMode === 'month' && styles.activeTab]} onPress={() => setViewMode('month')}>
            <Text style={[styles.tabText, viewMode === 'month' && styles.activeTabText]}>月</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.calendarWrapper}>
        {viewMode === 'week' ? (
          <View style={styles.weekStrip}>
            {weekDays.map((day) => (
              <TouchableOpacity key={day.dateStr} onPress={() => handleDateTap(day.dateStr)}
                style={[styles.dayItem, day.isSelected && styles.selectedDayItem, day.isToday && !day.isSelected && styles.todayItem]}>
                <Text style={[styles.dayLabel, day.isSelected && styles.selectedDayText]}>{day.dayLabel}</Text>
                <Text style={[styles.dayNum, day.isSelected && styles.selectedDayText]}>{day.dayNum}</Text>
                {day.hasTask && <View style={[styles.dot, day.isSelected && {backgroundColor:'#fff'}]} />}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Calendar
            current={selectedDate}
            onDayPress={(day: any) => handleDateTap(day.dateString)}
            markedDates={{ [selectedDate]: { selected: true, selectedColor: '#3498db' }, ...calendarMarks }}
            theme={{
              calendarBackground: '#1e1e1e', textSectionTitleColor: '#888', dayTextColor: '#fff',
              todayTextColor: '#e57373', selectedDayTextColor: '#ffffff', monthTextColor: '#fff',
              indicatorColor: '#3498db', textDayFontWeight: '600', textMonthFontWeight: 'bold'
            }}
          />
        )}
      </View>

      {viewMode === 'month' ? (
        <View style={styles.digestContainer}>
          <Text style={styles.sectionLabel}>📅 予定リスト (同じ日をもう一度タップで詳細へ)</Text>
          <ScrollView style={{flex:1}}>
            {digestTasks.length === 0 ? (
               <View style={styles.emptyState}><Text style={styles.emptyStateText}>予定はありません</Text></View>
            ) : (
               digestTasks.map(task => (
                 <TouchableOpacity key={task.id} style={styles.digestCard} onPress={() => openEditModal(task)}>
                   <View style={styles.digestTimeBox}>
                      {task.time ? <Text style={styles.digestTimeText}>{task.time}</Text> : <Ionicons name="help-circle" size={20} color="#e57373" />}
                   </View>
                   <View style={{flex:1}}>
                     <Text style={styles.digestTitle}>{task.title}</Text>
                     {task.description ? <Text style={styles.digestDesc} numberOfLines={1}>{task.description}</Text> : null}
                   </View>
                 </TouchableOpacity>
               ))
            )}
            <View style={{height:50}} />
          </ScrollView>
        </View>
      ) : (
        <View style={{flex:1}}>
          {unscheduledTasks.length > 0 && (
            <View style={styles.unscheduledWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={{flexDirection:'row', paddingHorizontal:20, gap:8, paddingBottom:10}}>
                  <View style={styles.alertBadge}><Text style={styles.alertText}>{unscheduledTasks.length}</Text></View>
                  {unscheduledTasks.map(task => (
                    <TouchableOpacity key={task.id} style={styles.unscheduledChip} onPress={() => openEditModal(task)}>
                      <Text style={styles.chipText}>{task.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
          <ScrollView ref={scrollViewRef} style={styles.scrollView} contentContainerStyle={{ paddingBottom: 100 }}>
            <View style={styles.timelineContainer}>
              {HOURS.map(hour => {
                const hourTasks = getTasksForHour(hour);
                const isNight = hour < 6 || hour >= 23; 
                return (
                  <View key={hour} style={[styles.hourRow, isNight && styles.nightRow]}>
                    <View style={styles.timeColumn}><Text style={styles.timeText}>{`${hour}:00`}</Text></View>
                    <Pressable style={styles.taskColumn}>
                      <View style={styles.gridLine} />
                      {renderCurrentTimeLine(hour)}
                      {hourTasks.map(task => (
                        <TouchableOpacity key={task.id} style={styles.scheduledCard} onPress={() => openEditModal(task)}>
                          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
                            <View style={{flex:1}}>
                              <Text style={styles.taskText} numberOfLines={2}>{task.title}</Text>
                              {task.description ? <Text style={styles.taskSubText} numberOfLines={1}>{task.description}</Text> : null}
                            </View>
                            {task.notificationId && <Ionicons name="notifications" size={12} color="rgba(255,255,255,0.7)" />}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      )}

      <Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>詳細編集</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}><Ionicons name="close-circle" size={30} color="#888" /></TouchableOpacity>
            </View>

            <ScrollView>
              <Text style={styles.label}>タスク名</Text>
              <TextInput style={styles.inputTitle} value={editTitle} onChangeText={setEditTitle} />

              <Text style={styles.label}>時間設定</Text>
              
              <View style={styles.timeSwitchRow}>
                <Text style={{color:'#ddd'}}>時間を指定する</Text>
                <TouchableOpacity 
                  onPress={() => { setIsTimeActive(!isTimeActive); Haptics.selectionAsync(); }}
                  style={[styles.switch, isTimeActive ? {backgroundColor:'#3498db'} : {backgroundColor:'#555'}]}
                >
                  <View style={[styles.switchKnob, isTimeActive ? {alignSelf:'flex-end'} : {alignSelf:'flex-start'}]} />
                </TouchableOpacity>
              </View>

              {isTimeActive && (
                <View style={styles.sliderContainer}>
                  <Text style={styles.sliderValueText}>{formatMinutesToTime(sliderValue)}</Text>
                  <Slider
                    style={{width: '100%', height: 40}}
                    minimumValue={0}
                    maximumValue={1440 - 15}
                    step={15} 
                    value={sliderValue}
                    onValueChange={(val) => { setSliderValue(val); }}
                    minimumTrackTintColor="#3498db"
                    maximumTrackTintColor="#555"
                    thumbTintColor="#fff"
                  />
                  <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                    <Text style={{color:'#666', fontSize:10}}>0:00</Text>
                    <Text style={{color:'#666', fontSize:10}}>12:00</Text>
                    <Text style={{color:'#666', fontSize:10}}>24:00</Text>
                  </View>
                </View>
              )}

              <Text style={[styles.label, {marginTop:20}]}>詳細メモ 📝</Text>
              <TextInput 
                style={styles.inputDesc} value={editDesc} onChangeText={setEditDesc} 
                multiline placeholder="詳細を書き込む..." placeholderTextColor="#555"
              />

              <TouchableOpacity style={styles.deleteButton} onPress={deleteTask}>
                <Ionicons name="trash-outline" size={20} color="#ff6161" />
                <Text style={styles.deleteText}>タスクを削除</Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity style={styles.saveButton} onPress={saveTaskChanges}>
              <Text style={styles.saveButtonText}>変更を保存</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingTop: 50 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  todayButton: { backgroundColor: '#333', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth:1, borderColor:'#555' },
  todayButtonText: { color: '#ddd', fontSize: 12, fontWeight: 'bold' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#333', borderRadius: 8, padding: 2 },
  tabButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  activeTab: { backgroundColor: '#3498db' },
  tabText: { color: '#888', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: '#fff' },
  calendarWrapper: { marginBottom: 10, borderBottomWidth:1, borderBottomColor:'#333' },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 10, paddingBottom: 10 },
  dayItem: { alignItems: 'center', padding: 8, borderRadius: 12, width: 45 },
  selectedDayItem: { backgroundColor: '#3498db' },
  todayItem: { borderWidth: 1, borderColor: '#e57373' },
  dayLabel: { color: '#888', fontSize: 10, marginBottom: 4 },
  dayNum: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  selectedDayText: { color: '#fff' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#e57373', marginTop: 4 },
  digestContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  sectionLabel: { color: '#888', marginBottom: 10, fontWeight: 'bold' },
  digestCard: { flexDirection:'row', backgroundColor:'#333', padding:16, borderRadius:12, marginBottom:8, alignItems:'center' },
  digestTimeBox: { width:60, alignItems:'center', borderRightWidth:1, borderRightColor:'#555', marginRight:15 },
  digestTimeText: { color:'#3498db', fontWeight:'bold', fontSize:16 },
  digestTitle: { color:'#fff', fontSize:16, fontWeight:'bold' },
  digestDesc: { color:'#aaa', fontSize:12, marginTop:4 },
  emptyState: { alignItems:'center', marginTop:50 },
  emptyStateText: { color:'#555', fontSize:16 },
  unscheduledWrapper: { height: 50, marginBottom: 5 },
  chipScroll: { flex: 1 },
  alertBadge: { backgroundColor: '#e57373', width:32, height:32, borderRadius:16, justifyContent:'center', alignItems:'center' },
  alertText: { color:'#fff', fontWeight:'bold' },
  unscheduledChip: { backgroundColor: '#333', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, justifyContent:'center', borderWidth:1, borderColor:'#444' },
  chipText: { color: '#ddd', fontWeight: '600' },
  scrollView: { flex: 1 },
  timelineContainer: { paddingTop: 10 },
  hourRow: { flexDirection: 'row', height: HOUR_HEIGHT },
  nightRow: { backgroundColor: 'rgba(0,0,0,0.3)' },
  timeColumn: { width: 60, alignItems: 'center' },
  timeText: { color: '#555', fontSize: 13, fontWeight: '600', transform: [{ translateY: -8 }] },
  taskColumn: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#333', paddingLeft: 10, paddingRight: 10, justifyContent: 'center' },
  gridLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#222' },
  currentTimeLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#e57373', zIndex: 10 },
  currentTimeDot: { position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: '#e57373' },
  scheduledCard: { backgroundColor: 'rgba(52, 152, 219, 0.15)', borderLeftWidth: 3, borderLeftColor: '#3498db', padding: 8, borderRadius: 6, marginBottom: 4, width: '95%' },
  taskText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  taskSubText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.8)' },
  modalContent: { backgroundColor: '#1e1e1e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  label: { color: '#888', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  inputTitle: { backgroundColor: '#333', color: '#fff', fontSize: 18, padding: 12, borderRadius: 8, fontWeight: 'bold', marginBottom: 20 },
  inputDesc: { backgroundColor: '#333', color: '#fff', fontSize: 16, padding: 12, borderRadius: 8, height: 100, textAlignVertical: 'top' },
  timeSwitchRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:15, backgroundColor:'#333', padding:10, borderRadius:8 },
  switch: { width:50, height:28, borderRadius:14, padding:2, justifyContent:'center' },
  switchKnob: { width:24, height:24, borderRadius:12, backgroundColor:'#fff' },
  sliderContainer: { backgroundColor:'#2a2a2a', padding:15, borderRadius:10, marginBottom:20 },
  sliderValueText: { color:'#3498db', fontSize:28, fontWeight:'bold', textAlign:'center', marginBottom:10 },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 30, marginBottom: 10 },
  deleteText: { color: '#ff6161', fontWeight: 'bold', marginLeft: 8 },
  saveButton: { backgroundColor: '#3498db', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10, marginBottom: 20 },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});