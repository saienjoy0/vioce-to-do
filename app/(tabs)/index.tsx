import { Ionicons } from '@expo/vector-icons';
import { GoogleGenerativeAI } from '@google/generative-ai';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays, addHours, format, setHours, setMinutes } from 'date-fns';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

const { width, height } = Dimensions.get('window');
const RECORD_BUTTON_SIZE = 100;

const GEMINI_API_KEY = 'AIzaSyBsF3TlxKQvEG46poRRzKUB7N6glzFCypU';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GEMINI_MODEL = 'gemini-2.0-flash';

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MAX,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
};

function uuid() {
  return Math.random().toString(36).slice(2) + "-" + Date.now();
}

const DigitalPulse = ({ mode }: { mode: 'recording' | 'processing' }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let interval: NodeJS.Timeout;
    Animated.loop(
      Animated.timing(anim, {
        toValue: 1, duration: mode === 'recording' ? 2000 : 1000, easing: Easing.out(Easing.ease), useNativeDriver: true,
      })
    ).start();
    if (mode === 'processing') {
      interval = setInterval(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [mode]);
  const color = mode === 'recording' ? 'rgba(229, 115, 115, 0.5)' : 'rgba(52, 152, 219, 0.5)';
  const coreColor = mode === 'recording' ? '#e57373' : '#3498db';
  return (
    <View style={styles.pulseContainer}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] }) }], opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] }) }]} />
      <Animated.View style={[styles.pulseRing, { backgroundColor: color, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.8] }) }], opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.2, 0] }) }]} />
      <View style={[styles.pulseCore, { backgroundColor: coreColor }]}>
        {mode === 'recording' ? <Ionicons name="mic" size={40} color="#fff" /> : <ActivityIndicator size="small" color="#fff" />}
      </View>
    </View>
  );
};

const ScannerOverlay = () => {
  const scanAnim = useRef(new Animated.Value(0)).current;
  const [scanText, setScanText] = useState("SCANNING TARGET...");

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 0, useNativeDriver: true })
      ])
    ).start();

    const messages = ["ANALYZING IMAGE...", "DETECTING TEXT...", "EXTRACTING DATES...", "GENERATING MISSIONS..."];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setScanText(messages[i]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 800);

    return () => clearInterval(interval);
  }, []);

  const translateY = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.6] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
      <View style={styles.scanHUD}>
        <ActivityIndicator size="small" color="#3498db" />
        <Text style={styles.scanText}>{scanText}</Text>
      </View>
    </View>
  );
};

export default function HomeScreen() {
  const [tasks, setTasks] = useState<{ id: string; title: string; time?: string; date?: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [aiPhase, setAiPhase] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  
  const [inputModalVisible, setInputModalVisible] = useState(false);
  const [manualInputText, setManualInputText] = useState('');
  const [manualSelectedTime, setManualSelectedTime] = useState<{time: string | null, date: string, label: string} | null>(null);

  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const anim = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const jsonValue = await AsyncStorage.getItem('my-voice-tasks');
        if (jsonValue != null) setTasks(JSON.parse(jsonValue));
      } catch (e) { console.error(e); }
      setIsLoaded(true);
    };
    loadTasks();
  }, []);

  useEffect(() => {
    const saveTasks = async () => {
      if (!isLoaded) return;
      try { await AsyncStorage.setItem('my-voice-tasks', JSON.stringify(tasks)); } 
      catch (e) { console.error(e); }
    };
    saveTasks();
  }, [tasks, isLoaded]);

  const sortedTasks = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeVal = currentHour * 60 + currentMinute;

    const todayScheduled = tasks.filter(t => t.date === todayStr && t.time).sort((a, b) => {
      const [h1, m1] = (a.time || '0:0').split(':').map(Number);
      const [h2, m2] = (b.time || '0:0').split(':').map(Number);
      return (h1 * 60 + m1) - (h2 * 60 + m2);
    });

    const upcomingTask = todayScheduled.find(t => {
      const [h, m] = (t.time || '0:0').split(':').map(Number);
      const taskTimeVal = h * 60 + m;
      return taskTimeVal >= currentTimeVal - 30; 
    });

    if (upcomingTask) {
      const others = tasks.filter(t => t.id !== upcomingTask.id).reverse();
      return [upcomingTask, ...others];
    }
    return [...tasks].reverse();
  }, [tasks]);

  const nowTask = sortedTasks[0];
  const nextTasks = sortedTasks.slice(1, 4);

  const completeTask = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCompletingTaskId(id);
    setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTasks(prev => prev.filter(t => t.id !== id));
      setCompletingTaskId(null);
    }, 400); 
  };

  const handlePressIn = async () => {
    setError(null);
    setAiPhase('recording');
    setIsRecording(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { setError('マイク権限がありません'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1.1, duration: 500, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } catch (err: any) {
      setError(err.message);
      setIsRecording(false);
      setAiPhase('idle');
    }
  };

  const handlePressOut = async () => {
    if (aiPhase !== 'recording') return;
    setIsRecording(false);
    setAiPhase('processing');
    anim.stopAnimation();
    Animated.timing(anim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (!recordingRef.current) return;
    try {
      const recording = recordingRef.current;
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error('音声ファイルなし');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

      const prompt = [
        {
          "role": "user",
          "parts": [
            { "text": '音声からタスクを抽出しJSON配列で返して。キーは { title: string, time: string(HH:MM形式, なければnull) } 。例: [{"title":"会議","time":"14:00"}]。雑談は無視。JSONのみ返すこと。' },
            { "inlineData": { "mimeType": "audio/m4a", "data": base64 } }
          ]
        }
      ];
      await processAIResponse(prompt);
    } catch (err: any) {
      setError(err.message);
      setAiPhase('idle');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    recordingRef.current = null;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  };

  const processAIResponse = async (prompt: any) => {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent({ contents: prompt });
    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\[\s*\{[\s\S]+?\}\s*\]/);
    if (!jsonMatch) throw new Error('AIがタスクを見つけられませんでした');
    const tasksArray = JSON.parse(jsonMatch[0]);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    setTasks(prev => [...prev, ...tasksArray.map((t: any) => ({
      id: uuid(), title: t.title?.toString() ?? '(無題)', time: t.time?.toString() ?? null, date: todayStr
    }))]);
    setAiPhase('idle');
    setIsProcessingImage(false);
    setCapturedImage(null);
    setCameraModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert("カメラの権限が必要です");
        return;
      }
    }
    setCapturedImage(null);
    setCameraModalVisible(true);
    Haptics.selectionAsync();
  };

  const takePictureAndAnalyze = async () => {
    if (!cameraRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsProcessingImage(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
      if (photo?.uri) setCapturedImage(photo.uri);
      const resizedPhoto = await ImageManipulator.manipulateAsync(
        photo?.uri || '', [{ resize: { width: 800 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!resizedPhoto.base64) throw new Error("画像の処理に失敗しました");
      const prompt = [
        {
          "role": "user",
          "parts": [
            { "text": 'この画像に写っている文書やメモから、やるべき「タスク」と、もしあれば「時間」を抽出し、JSON配列で返してください。キーは { title: string, time: string(HH:MM形式, なければnull) } 。例: [{"title":"牛乳を買う","time":null}, {"title":"歯医者","time":"15:30"}]。JSONのみを返してください。' },
            { "inlineData": { "mimeType": "image/jpeg", "data": resizedPhoto.base64 } }
          ]
        }
      ];
      await processAIResponse(prompt);
    } catch (e: any) {
      Alert.alert("エラー", e.message);
      setIsProcessingImage(false);
      setCapturedImage(null);
    }
  };

  const setQuickTime = (type: 'none' | 'plus1h' | 'morning' | 'afternoon' | 'evening' | 'tomorrow') => {
    const now = new Date();
    let newDate = now;
    let timeStr = null;
    let label = '未定';
    switch (type) {
      case 'none': timeStr = null; label = '時間指定なし'; break;
      case 'plus1h': newDate = addHours(now, 1); timeStr = format(newDate, 'HH:mm'); label = `今日 ${timeStr}`; break;
      case 'morning': newDate = setMinutes(setHours(now, 9), 0); timeStr = '09:00'; label = '今日の朝 (9:00)'; break;
      case 'afternoon': newDate = setMinutes(setHours(now, 13), 0); timeStr = '13:00'; label = '今日の昼 (13:00)'; break;
      case 'evening': newDate = setMinutes(setHours(now, 18), 0); timeStr = '18:00'; label = '今日の夕方 (18:00)'; break;
      case 'tomorrow': newDate = setMinutes(setHours(addDays(now, 1), 9), 0); timeStr = '09:00'; label = '明日の朝 (9:00)'; break;
    }
    setManualSelectedTime({ time: timeStr, date: format(newDate, 'yyyy-MM-dd'), label: label });
    Haptics.selectionAsync();
  };

  const addManualTask = () => {
    if (!manualInputText.trim()) return;
    const timeInfo = manualSelectedTime || { time: null, date: format(new Date(), 'yyyy-MM-dd'), label: '未定' };
    const newTask = {
      id: uuid(), title: manualInputText, time: timeInfo.time, date: timeInfo.date
    };
    setTasks(prev => [...prev, newTask]);
    setManualInputText('');
    setManualSelectedTime(null);
    setInputModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  let statusText = "Ready to Capture";
  if (aiPhase === 'recording') statusText = "Listening...";
  if (aiPhase === 'processing') statusText = "AI Analyzing...";

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>COCKPIT</Text>
        <View style={styles.dateBadge}><Text style={styles.dateText}>{format(new Date(), 'M/d')}</Text></View>
      </View>

      <View style={styles.missionSection}>
        <Text style={styles.sectionLabel}>CURRENT MISSION</Text>
        {nowTask ? (
          <Pressable 
            style={[styles.mainCard, nowTask.id === completingTaskId && { backgroundColor: 'rgba(52, 152, 219, 0.2)', borderColor: '#3498db' }]} 
            onPress={() => completeTask(nowTask.id)}
          >
             {nowTask.id === completingTaskId ? (
               <View style={styles.completeOverlay}>
                 <Ionicons name="checkmark-circle" size={60} color="#3498db" />
                 <Text style={styles.completeText}>MISSION CLEAR</Text>
               </View>
             ) : (
               <>
                 <View style={[styles.cardGlow, nowTask.time ? {backgroundColor:'#e57373'} : {backgroundColor:'#3498db'}]} />
                 {nowTask.time ? (
                   <View style={{flexDirection:'row', alignItems:'center', gap:5, marginBottom:10}}>
                     <Ionicons name="time" size={24} color="#e57373" />
                     <Text style={[styles.mainTime, {color:'#e57373'}]}>{nowTask.time}</Text>
                   </View>
                 ) : (
                   <View style={{backgroundColor:'#3498db', paddingHorizontal:8, paddingVertical:2, borderRadius:4, marginBottom:15}}><Text style={{color:'#fff', fontSize:10, fontWeight:'bold'}}>NEW ENTRY</Text></View>
                 )}
                 <Text style={styles.mainTitle}>{nowTask.title}</Text>
                 <View style={styles.completeHint}><Ionicons name="checkmark-circle-outline" size={16} color="#666" /><Text style={styles.hintText}>Tap to Complete</Text></View>
               </>
             )}
          </Pressable>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle" size={60} color="#333" />
            <Text style={styles.emptyText}>All Systems Clear</Text>
            <Text style={styles.emptySubText}>ボタンを押してタスクを追加</Text>
          </View>
        )}
      </View>

      <View style={styles.queueSection}>
        <Text style={styles.sectionLabel}>NEXT QUEUE</Text>
        <FlatList
          data={nextTasks}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Pressable 
              style={[styles.queueItem, item.id === completingTaskId && { backgroundColor: '#2c3e50', borderColor: '#3498db', borderWidth:1 }]} 
              onPress={() => completeTask(item.id)}
            >
              {item.id === completingTaskId ? (
                 <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', flex:1}}><Text style={{color:'#3498db', fontWeight:'bold', letterSpacing:1}}>COMPLETED</Text></View>
              ) : (
                <>
                  <View style={styles.queueTimeBox}><Text style={[styles.queueTime, item.time && {color:'#e57373'}]}>{item.time || '--:--'}</Text></View>
                  <Text style={styles.queueTitle} numberOfLines={1}>{item.title}</Text>
                </>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.emptyQueue}>No pending tasks</Text>}
        />
      </View>

      <View style={styles.controlSection}>
        <TouchableOpacity style={styles.sideButtonLeft} onPress={() => { setManualInputText(''); setManualSelectedTime(null); setInputModalVisible(true); Haptics.selectionAsync(); }} disabled={aiPhase !== 'idle'}>
          <Ionicons name="create-outline" size={24} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideButtonRight} onPress={openCamera} disabled={aiPhase !== 'idle'}>
          <Ionicons name="camera-outline" size={24} color="#aaa" />
        </TouchableOpacity>
        <Pressable onPressIn={aiPhase === 'idle' ? handlePressIn : undefined} onPressOut={handlePressOut} style={styles.micArea} disabled={aiPhase === 'processing'}>
          {aiPhase !== 'idle' ? <DigitalPulse mode={aiPhase as 'recording' | 'processing'} /> : <View style={styles.micButton}><Ionicons name="mic" size={40} color="#fff" /></View>}
        </Pressable>
        <View style={styles.statusContainer}>
           <Text style={[styles.statusText, { color: aiPhase === 'recording' ? '#e57373' : aiPhase === 'processing' ? '#3498db' : '#666' }]}>{statusText}</Text>
           {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>

      {/* カメラモーダル (修正: UIを兄弟要素に) */}
      <Modal animationType="slide" visible={cameraModalVisible} onRequestClose={() => setCameraModalVisible(false)}>
        <View style={styles.cameraContainer}>
          {permission?.granted ? (
            capturedImage ? (
              <ImageBackground source={{ uri: capturedImage }} style={styles.camera}>
                {isProcessingImage ? <ScannerOverlay /> : <View style={styles.cameraOverlay}><ActivityIndicator size="large" color="#fff" /></View>}
              </ImageBackground>
            ) : (
              <View style={{flex: 1}}>
                <CameraView style={StyleSheet.absoluteFill} facing="back" ref={cameraRef} />
                {/* オーバーレイをCameraViewの外（兄弟）に配置 */}
                <View style={styles.cameraOverlay}>
                  <TouchableOpacity style={styles.closeCameraBtn} onPress={() => setCameraModalVisible(false)}>
                     <Ionicons name="close" size={30} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shutterBtn} onPress={takePictureAndAnalyze}>
                    <View style={styles.shutterBtnInner} />
                  </TouchableOpacity>
                </View>
              </View>
            )
          ) : (
            <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
               <Text style={{color:'#fff', marginBottom:20}}>カメラ権限が必要です</Text>
               <TouchableOpacity style={styles.addButton} onPress={requestPermission}><Text style={styles.addButtonText}>許可する</Text></TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* 手動入力モーダル */}
      <Modal animationType="slide" transparent={true} visible={inputModalVisible} onRequestClose={() => setInputModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>TASK ENTRY</Text>
              <TouchableOpacity onPress={() => setInputModalVisible(false)}><Ionicons name="close" size={24} color="#888" /></TouchableOpacity>
            </View>
            <TextInput style={styles.textInput} placeholder="何をする？" placeholderTextColor="#555" value={manualInputText} onChangeText={setManualInputText} autoFocus returnKeyType="done" />
            <View style={styles.selectedTimeDisplay}>
              <Ionicons name="time-outline" size={16} color="#3498db" />
              <Text style={styles.selectedTimeText}>{manualSelectedTime ? manualSelectedTime.label : '時間指定なし'}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeCommandScroll}>
              <TouchableOpacity style={styles.timeCommandBtn} onPress={() => setQuickTime('none')}><Text style={styles.timeCommandText}>指定なし</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.timeCommandBtn, styles.timeCommandBtnActive]} onPress={() => setQuickTime('plus1h')}><Text style={[styles.timeCommandText, styles.timeCommandTextActive]}>🚀 +1時間</Text></TouchableOpacity>
              <TouchableOpacity style={styles.timeCommandBtn} onPress={() => setQuickTime('morning')}><Text style={styles.timeCommandText}>朝 9:00</Text></TouchableOpacity>
              <TouchableOpacity style={styles.timeCommandBtn} onPress={() => setQuickTime('afternoon')}><Text style={styles.timeCommandText}>昼 13:00</Text></TouchableOpacity>
              <TouchableOpacity style={styles.timeCommandBtn} onPress={() => setQuickTime('evening')}><Text style={styles.timeCommandText}>夕 18:00</Text></TouchableOpacity>
              <TouchableOpacity style={styles.timeCommandBtn} onPress={() => setQuickTime('tomorrow')}><Text style={styles.timeCommandText}>明日 9:00</Text></TouchableOpacity>
            </ScrollView>
            <TouchableOpacity style={styles.addButton} onPress={addManualTask}><Text style={styles.addButtonText}>ADD MISSION</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  headerTitle: { color: '#888', fontSize: 14, letterSpacing: 4, fontWeight: 'bold' },
  dateBadge: { backgroundColor: '#333', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  dateText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  sectionLabel: { color: '#555', fontSize: 12, fontWeight: 'bold', marginBottom: 10, letterSpacing: 1 },
  missionSection: { flex: 2, marginBottom: 20 },
  mainCard: { flex:1, backgroundColor: '#1e1e1e', borderRadius: 24, padding: 24, justifyContent: 'center', alignItems: 'center', borderWidth:1, borderColor:'#333', overflow:'hidden' },
  cardGlow: { position:'absolute', top:0, left:0, right:0, height:4, opacity:0.8 },
  mainTime: { fontSize: 32, fontWeight: 'bold', letterSpacing:1 },
  mainTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  completeHint: { flexDirection:'row', alignItems:'center', opacity:0.5, gap:6 },
  hintText: { color: '#888', fontSize: 12 },
  emptyState: { flex:1, justifyContent:'center', alignItems:'center', borderStyle:'dashed', borderWidth:2, borderColor:'#222', borderRadius:24 },
  emptyText: { color: '#555', fontSize: 18, fontWeight: 'bold', marginTop: 15 },
  emptySubText: { color: '#444', fontSize: 14, marginTop: 5 },
  queueSection: { flex: 1.5, marginBottom: 20 },
  queueItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', padding: 16, borderRadius: 12, marginBottom: 8, height: 60 },
  queueTimeBox: { width: 50, alignItems:'center', marginRight:10 },
  queueTime: { color: '#888', fontSize: 12, fontWeight:'bold' },
  queueTitle: { color: '#ddd', fontSize: 16, flex:1 },
  emptyQueue: { color: '#444', textAlign: 'center', marginTop: 10, fontStyle:'italic' },
  
  controlSection: { height: 160, alignItems: 'center' },
  micArea: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
  micButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#555', shadowColor: '#000', shadowOffset: {width:0, height:4}, shadowOpacity:0.3, shadowRadius:5 },
  statusContainer: { position:'absolute', bottom: 10, alignItems:'center' },
  statusText: { fontSize: 12, letterSpacing: 1, textTransform:'uppercase' },
  errorText: { color: '#e57373', marginTop: 5, fontSize: 12 },
  sideButtonLeft: { position: 'absolute', left: 20, top: 40, width: 50, height: 50, borderRadius: 25, backgroundColor: '#1e1e1e', justifyContent: 'center', alignItems: 'center', borderWidth:1, borderColor:'#333' },
  sideButtonRight: { position: 'absolute', right: 20, top: 40, width: 50, height: 50, borderRadius: 25, backgroundColor: '#1e1e1e', justifyContent: 'center', alignItems: 'center', borderWidth:1, borderColor:'#333' },
  pulseContainer: { justifyContent: 'center', alignItems: 'center', width: 100, height: 100 },
  pulseCore: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  pulseRing: { position: 'absolute', width: 100, height: 100, borderRadius: 50, zIndex: 1 },
  completeOverlay: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  completeText: { color: '#3498db', fontSize: 20, fontWeight: 'bold', letterSpacing: 2, marginTop: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.8)' },
  modalContent: { backgroundColor: '#1e1e1e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { color: '#888', fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  textInput: { backgroundColor: '#333', color: '#fff', fontSize: 20, padding: 16, borderRadius: 12, marginBottom: 15, fontWeight:'bold' },
  selectedTimeDisplay: { flexDirection:'row', alignItems:'center', gap:6, marginBottom:10, paddingLeft:5 },
  selectedTimeText: { color: '#3498db', fontWeight:'bold', fontSize:14 },
  timeCommandScroll: { flexDirection: 'row', marginBottom: 20 },
  timeCommandBtn: { backgroundColor: '#333', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, marginRight: 10, borderWidth:1, borderColor:'#444' },
  timeCommandBtnActive: { backgroundColor: '#3498db', borderColor: '#3498db' },
  timeCommandText: { color: '#ccc', fontWeight: 'bold', fontSize: 12 },
  timeCommandTextActive: { color: '#fff' },
  addButton: { backgroundColor: '#3498db', padding: 16, borderRadius: 12, alignItems: 'center' },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14, letterSpacing: 1 },

  // カメラ & スキャン演出
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1, justifyContent:'center', alignItems:'center' },
  // ★修正: オーバーレイのスタイル（絶対配置）
  cameraOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 50 },
  closeCameraBtn: { position: 'absolute', top: 50, left: 20, padding:10, backgroundColor:'rgba(0,0,0,0.5)', borderRadius:20 },
  shutterBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  shutterBtnInner: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' },
  
  // スキャン演出
  scanLine: { width: '100%', height: 2, backgroundColor: '#00ffcc', shadowColor:'#00ffcc', shadowOpacity:1, shadowRadius:10, elevation:5 },
  scanHUD: { position:'absolute', bottom: 100, flexDirection:'row', alignItems:'center', gap:10, backgroundColor:'rgba(0,0,0,0.6)', padding:10, borderRadius:8 },
  scanText: { color: '#00ffcc', fontSize: 14, fontWeight:'bold', letterSpacing:1 }
});