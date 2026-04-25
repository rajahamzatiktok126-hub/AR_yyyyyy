import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  BookOpen, 
  ArrowLeft, 
  Star, 
  Trophy, 
  RotateCcw,
  Sparkles,
  Search,
  MousePointer2,
  Info,
  X
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { GoogleGenAI } from "@google/genai";

import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';

// --- Types ---
type Screen = 'home' | 'learn' | 'game-select' | 'stats' | 'counting-game' | 'memory-game' | 
              'greater-less' | 'sequence-game' | 'bubble-pop' | 'pattern-match' | 'addition-game';

interface UserStats {
  totalScore: number;
  gamesPlayed: number;
  correctAnswers: number;
  wrongAnswers: number;
}

interface LeaderboardEntry {
  userName: string;
  score: number;
  gameType: string;
  timestamp: Timestamp;
}

interface CountingChallenge {
  number: number;
  item: string;
  icon: string;
}

// --- Constants ---
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COLORS = [
  'bg-red-400', 'bg-blue-400', 'bg-green-400', 'bg-yellow-400', 
  'bg-purple-400', 'bg-pink-400', 'bg-orange-400', 'bg-teal-400',
  'bg-indigo-400', 'bg-rose-400'
];

const ITEM_ICONS: Record<string, string> = {
  apple: '🍎',
  star: '⭐',
  ball: '⚽',
  cat: '🐱',
  flower: '🌸',
  car: '🚗',
  fish: '🐟',
  bird: '🐦',
  cookie: '🍪',
  butterfly: '🦋'
};

// --- Sound Helper (Simple Web Audio API) ---
const playSound = (type: 'correct' | 'wrong' | 'click' | 'pop') => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  if (type === 'correct') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.1); // C6
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'wrong') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'click') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (type === 'pop') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  }
};

// --- Components ---

const NumberCard = ({ num, color, delay }: { num: number, color: string, delay: number }) => (
  <motion.div
    initial={{ scale: 0, rotate: -10 }}
    animate={{ scale: 1, rotate: 0 }}
    whileHover={{ scale: 1.1, rotate: 5 }}
    transition={{ type: 'spring', stiffness: 260, damping: 20, delay }}
    className={`${color} w-32 h-44 rounded-3xl flex items-center justify-center shadow-xl cursor-pointer border-4 border-white`}
  >
    <span className="text-7xl font-black text-white drop-shadow-md">{num}</span>
  </motion.div>
);

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [infoModal, setInfoModal] = useState<string | null>(null);
  const [currentLearnNum, setCurrentLearnNum] = useState(1);

  const triggerConfetti = () => {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF9F43', '#A29BFE']
    });
  };

  const GameInfoModal = ({ game }: { game: string }) => {
    const info: Record<string, { title: string, text: string }> = {
      'counting-game': { 
        title: 'I SPY', 
        text: 'Look at the picture and count how many stars there are! Then tap the correct number at the bottom. 🔎⭐' 
      },
      'memory-game': { 
        title: 'MEMORY', 
        text: 'Tap the cards to flip them and find the matching number pairs. Try to remember where each number is hiding! 🧠✨' 
      },
      'greater-less': { 
        title: 'BIG OR SMALL', 
        text: 'Look at the two numbers on the screen and tap the one that is bigger! Can you spot the giant number? 🐘🐭' 
      },
      'sequence-game': { 
        title: 'SEQUENCE', 
        text: 'A string of numbers is missing a piece! Look at the order and pick the number that comes next. 🔢➡️' 
      },
      'bubble-pop': { 
        title: 'POP IT', 
        text: 'Bubbles with numbers are floating up! Check the target number at the top and pop the bubbles that match it. 🫧💥' 
      },
      'pattern-match': { 
        title: 'PATTERNS', 
        text: 'Look at the sequence of emojis! Figure out the pattern and pick what comes next to finish the line. 🍎⭐🍎?' 
      },
      'addition-game': { 
        title: 'ADD UP', 
        text: 'Count two groups of apples and add them together to find the total! Tap the correct sum. 🍎+🍎=🍎🍎' 
      }
    };

    const content = info[game];
    if (!content) return null;

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-white w-full max-w-sm rounded-[40px] bento-border bento-shadow-lg p-8 relative"
        >
          <button 
            onClick={() => setInfoModal(null)}
            className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
          >
            <X size={24} />
          </button>
          <h2 className="text-3xl font-black text-[#333] mb-4 uppercase tracking-tighter">{content.title}</h2>
          <p className="text-xl font-bold text-gray-600 leading-relaxed mb-6">{content.text}</p>
          <button 
            onClick={() => setInfoModal(null)}
            className="w-full py-4 bg-blue-500 text-white rounded-2xl bento-border bento-shadow text-2xl font-black uppercase tracking-tight"
          >
            Got it!
          </button>
        </motion.div>
      </motion.div>
    );
  };
  const [user, setUser] = useState<User | null>(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('number_pals_name') || 'Little Pal');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u?.displayName && !localStorage.getItem('number_pals_name')) {
        setPlayerName(u.displayName.split(' ')[0]);
      }
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      playSound('click');
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
    }
  };

  const submitScore = async (gameType: 'memory' | 'addition', scoreValue: number) => {
    if (!user) return;
    try {
      const colPath = 'scores';
      await addDoc(collection(db, colPath), {
        userName: playerName,
        score: scoreValue,
        gameType: gameType,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scores');
    }
  };

  const [score, setScore] = useState(0);

  const [stats, setStats] = useState<UserStats>(() => {
    const saved = localStorage.getItem('number_pals_stats');
    return saved ? JSON.parse(saved) : { totalScore: 0, gamesPlayed: 0, correctAnswers: 0, wrongAnswers: 0 };
  });

  useEffect(() => {
    localStorage.setItem('number_pals_stats', JSON.stringify(stats));
  }, [stats]);

  const updateStats = (points: number, isCorrect: boolean) => {
    setStats(prev => ({
      ...prev,
      totalScore: prev.totalScore + points,
      correctAnswers: isCorrect ? prev.correctAnswers + 1 : prev.correctAnswers,
      wrongAnswers: !isCorrect ? prev.wrongAnswers + 1 : prev.wrongAnswers,
    }));
  };

  const incrementGamesPlayed = () => {
    setStats(prev => ({ ...prev, gamesPlayed: prev.gamesPlayed + 1 }));
  };

  // --- Screens ---

  const HomeScreen = () => (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center min-h-screen p-6 bg-[#FDFCF0]"
    >
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="mb-12 flex flex-col items-center"
      >
        <div className="flex gap-3 mb-3">
          {["N", "U", "M", "B", "E", "R"].map((l, i) => (
            <div key={i} className={`${COLORS[i % COLORS.length]} w-14 h-14 bento-border bento-shadow rounded-xl flex items-center justify-center`}>
              <span className="text-2xl font-black text-white">{l}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          {["P", "A", "L", "S"].map((l, i) => (
            <div key={i} className={`${COLORS[(i + 6) % COLORS.length]} w-14 h-14 bento-border bento-shadow rounded-xl flex items-center justify-center`}>
              <span className="text-2xl font-black text-white">{l}</span>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-6 max-w-md w-full">
        <motion.button
          whileHover={{ scale: 1.05, y: -4 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { playSound('click'); setScreen('learn'); }}
          className="bg-orange-400 text-white p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-4 cursor-pointer"
        >
          <div className="bg-white p-4 rounded-2xl bento-border bento-shadow text-orange-500">
            <BookOpen size={40} />
          </div>
          <span className="text-2xl font-black uppercase tracking-tight">Learn</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05, y: -4 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { playSound('click'); setScreen('game-select'); }}
          className="bg-green-300 text-[#333] p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-4 cursor-pointer"
        >
          <div className="bg-white p-4 rounded-2xl bento-border bento-shadow text-green-500">
            <Play size={40} />
          </div>
          <span className="text-2xl font-black uppercase tracking-tight">Play</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05, y: -4 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { playSound('click'); setScreen('stats'); }}
          className="col-span-2 bg-blue-400 text-white p-6 rounded-[32px] bento-border bento-shadow-lg flex items-center justify-between px-10 cursor-pointer"
        >
          <div className="flex items-center gap-4">
             <div className="bg-white p-2 rounded-xl bento-border bento-shadow text-blue-500">
              <Trophy size={32} />
            </div>
            <span className="text-3xl font-black uppercase tracking-tighter">My Stats</span>
          </div>
          <div className="text-right">
             <div className="text-sm font-bold opacity-80">Total Score</div>
             <div className="text-3xl font-black tracking-tight">{stats.totalScore}</div>
          </div>
        </motion.button>
      </div>

      <div className="mt-12 flex gap-4 overflow-hidden py-4">
        {[1,2,3,4,5].map(n => (
          <motion.div 
            key={n}
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 3, delay: n * 0.2 }}
            className={`${COLORS[n]} w-12 h-12 rounded-lg bento-border bento-shadow flex items-center justify-center text-white font-bold text-xl`}
          >
            {n}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );

  const StatsScreen = () => {
    const accuracy = stats.correctAnswers + stats.wrongAnswers > 0
      ? Math.round((stats.correctAnswers / (stats.correctAnswers + stats.wrongAnswers)) * 100)
      : 0;

    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
    const [lbType, setLbType] = useState<'memory' | 'addition'>('memory');

    useEffect(() => {
      const fetchLeaderboard = async () => {
        setLoadingLeaderboard(true);
        try {
          const q = query(
            collection(db, 'scores'),
            where('gameType', '==', lbType),
            orderBy('score', 'desc'),
            limit(10)
          );
          const snapshot = await getDocs(q);
          const results = snapshot.docs.map(doc => doc.data() as LeaderboardEntry);
          setLeaderboard(results);
        } catch (error) {
          console.error("Leaderboard fetch error:", error);
        } finally {
          setLoadingLeaderboard(false);
        }
      };

      fetchLeaderboard();
    }, [lbType]);

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="min-h-screen p-6 pb-20 flex flex-col items-center"
      >
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => { playSound('click'); setScreen('home'); }} className="p-4 bg-white rounded-2xl bento-border bento-shadow">
            <ArrowLeft size={32} />
          </button>
          <span className="text-3xl font-black text-[#333] uppercase tracking-tighter">My Progress</span>
          <div className="w-14 h-14" />
        </header>

        <main className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
          <div className="flex flex-col gap-6">
            {/* Profile / Login */}
            <section className="bg-white bento-border rounded-[40px] bento-shadow-lg p-8">
              {!user ? (
                <div className="text-center">
                  <h3 className="text-2xl font-black mb-4 uppercase">Join the Leaderboard!</h3>
                  <button 
                    onClick={loginWithGoogle}
                    className="w-full py-4 bg-blue-500 text-white rounded-2xl bento-border bento-shadow font-black uppercase text-xl flex items-center justify-center gap-3"
                  >
                    <Trophy size={24} /> Login to Play
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-blue-100 rounded-full bento-border flex items-center justify-center text-4xl overflow-hidden">
                    {user.photoURL ? <img src={user.photoURL} alt="profile" referrerPolicy="no-referrer" /> : '👤'}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-black uppercase opacity-40">Hello,</h3>
                    <input 
                      type="text" 
                      value={playerName}
                      onChange={(e) => {
                        const val = e.target.value.slice(0, 15);
                        setPlayerName(val);
                        localStorage.setItem('number_pals_name', val);
                      }}
                      className="text-2xl font-black w-full bg-transparent border-b-2 border-dashed border-gray-200 focus:border-blue-400 outline-none"
                    />
                    <p className="text-xs font-bold text-gray-400 mt-1">Tap to change name</p>
                  </div>
                  <button onClick={() => auth.signOut()} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                    <X size={20} />
                  </button>
                </div>
              )}
            </section>

            <div className="grid grid-cols-2 gap-6">
              {/* Total Score */}
              <section className="col-span-2 bg-yellow-300 bento-border rounded-[40px] bento-shadow-lg p-8 flex flex-col justify-center items-center">
                 <Trophy size={64} className="text-[#333] mb-4" />
                 <h3 className="text-xl font-black uppercase text-[#333] opacity-60">Total Score</h3>
                 <span className="text-7xl font-black tracking-tighter text-[#333]">{stats.totalScore}</span>
              </section>

              {/* Games Played */}
              <section className="bg-pink-300 bento-border rounded-[40px] bento-shadow-lg p-6 flex flex-col justify-center items-center">
                 <Play size={40} className="text-[#333] mb-2" />
                 <h3 className="text-sm font-black uppercase text-[#333] opacity-60">Games</h3>
                 <span className="text-5xl font-black text-[#333]">{stats.gamesPlayed}</span>
              </section>

              {/* Accuracy */}
              <section className="bg-green-300 bento-border rounded-[40px] bento-shadow-lg p-6 flex flex-col justify-center items-center">
                 <Star size={40} className="text-[#333] mb-2" />
                 <h3 className="text-sm font-black uppercase text-[#333] opacity-60">Accuracy</h3>
                 <span className="text-5xl font-black text-[#333]">{accuracy}%</span>
              </section>
            </div>
          </div>

          {/* Global Leaderboard */}
          <section className="bg-white bento-border rounded-[40px] bento-shadow-lg p-8 flex flex-col h-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-black uppercase tracking-tight">World Best</h3>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
                <button 
                  onClick={() => { playSound('click'); setLbType('memory'); }}
                  className={`px-3 py-1 rounded-lg text-xs font-black uppercase transition-all ${lbType === 'memory' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-400'}`}
                >
                  Memory
                </button>
                <button 
                  onClick={() => { playSound('click'); setLbType('addition'); }}
                  className={`px-3 py-1 rounded-lg text-xs font-black uppercase transition-all ${lbType === 'addition' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`}
                >
                  Addition
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4">
              {loadingLeaderboard ? (
                <div className="h-full flex items-center justify-center italic text-gray-400 font-bold">Loading records...</div>
              ) : leaderboard.length === 0 ? (
                <div className="h-full flex items-center justify-center italic text-gray-400 font-bold">No records yet. Be the first!</div>
              ) : (
                leaderboard.map((entry, index) => (
                  <div key={index} className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl bento-border">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${index === 0 ? 'bg-yellow-400 text-white' : index === 1 ? 'bg-gray-300 text-white' : index === 2 ? 'bg-orange-300 text-white' : 'bg-gray-200 text-gray-500'}`}>
                      {index + 1}
                    </div>
                    <span className="flex-1 font-black text-[#333] truncate">{entry.userName}</span>
                    <span className="font-black text-blue-500">{entry.score}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Reset Stats (Helpful) */}
          <section className="md:col-span-2 bg-white bento-border rounded-[40px] bento-shadow-lg p-6 flex items-center justify-between px-10">
             <div className="text-left">
               <h3 className="text-xl font-black uppercase">Good Job!</h3>
               <p className="text-sm font-bold opacity-60">Keep playing to learn more!</p>
             </div>
             <motion.button 
               whileTap={{ scale: 0.9 }}
               onClick={() => {
                 if (confirm("Reset all local statistics? (Leaderboard scores won't change)")) {
                   setStats({ totalScore: 0, gamesPlayed: 0, correctAnswers: 0, wrongAnswers: 0 });
                   playSound('click');
                 }
               }}
               className="p-4 bg-gray-100 rounded-2xl bento-border bento-shadow text-red-500"
             >
               <RotateCcw size={24} />
             </motion.button>
          </section>
        </main>
      </motion.div>
    );
  };

  const LearnScreen = () => (
    <motion.div 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      className="min-h-screen p-6 flex flex-col items-center"
    >
      <header className="w-full flex justify-between items-center mb-12">
        <button onClick={() => setScreen('home')} className="p-4 bg-white rounded-2xl bento-border bento-shadow hover:bg-gray-50 transition-colors">
          <ArrowLeft size={32} />
        </button>
        <span className="text-3xl font-black text-[#333] tracking-tighter">LEARNING ZONE</span>
        <div className="w-14 h-14 bg-yellow-400 rounded-2xl bento-border bento-shadow flex items-center justify-center text-[#333] font-black text-xl">
          {NUMBERS.length}
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-lg">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentLearnNum}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.2, opacity: 0 }}
            className="flex flex-col items-center"
          >
            <div className={`bg-white w-72 h-[440px] rounded-[48px] bento-border bento-shadow-lg flex flex-col items-center justify-center p-8 relative overflow-hidden`}>
              {/* Background Glow Effect */}
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.2, 1], opacity: [0, 0.5, 0.2] }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className={`absolute inset-0 ${COLORS[currentLearnNum - 1]} blur-[60px] opacity-20`}
              />

              <motion.div 
                initial={{ rotate: -15, scale: 0.5 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                className={`${COLORS[currentLearnNum - 1]} w-full h-2/3 rounded-[32px] bento-border flex items-center justify-center relative z-10`}
              >
                <motion.span 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                  className="text-[120px] font-black text-white drop-shadow-xl z-20"
                >
                  {currentLearnNum}
                </motion.span>
                
                {/* Decorative Dashed Ring */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-[12px] border-dashed border-white/20 rounded-[28px]" 
                />
              </motion.div>

              <div className="mt-8 flex flex-wrap justify-center gap-3 relative z-10">
                {Array.from({ length: currentLearnNum }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0, y: 30, rotate: -45 }}
                    animate={{ scale: 1, y: 0, rotate: 0 }}
                    whileHover={{ scale: 1.3, rotate: 15 }}
                    transition={{ 
                      delay: 0.3 + (i * 0.1), 
                      type: 'spring', 
                      stiffness: 400, 
                      damping: 12 
                    }}
                    className="text-4xl filter drop-shadow-sm cursor-pointer"
                  >
                    ⭐
                  </motion.div>
                ))}
              </div>
            </div>
            
            <p className="mt-8 text-4xl font-black text-[#333] uppercase tracking-widest bg-yellow-300 px-8 py-2 rounded-full bento-border bento-shadow">
               {currentLearnNum === 1 ? 'One' : 
                currentLearnNum === 2 ? 'Two' :
                currentLearnNum === 3 ? 'Three' :
                currentLearnNum === 4 ? 'Four' :
                currentLearnNum === 5 ? 'Five' :
                currentLearnNum === 6 ? 'Six' :
                currentLearnNum === 7 ? 'Seven' :
                currentLearnNum === 8 ? 'Eight' :
                currentLearnNum === 9 ? 'Nine' : 'Ten'}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-auto w-full py-8 flex justify-center gap-6">
        <button 
          onClick={() => setCurrentLearnNum(Math.max(1, currentLearnNum - 1))}
          className="p-6 bg-blue-100 rounded-3xl text-blue-600 bento-border bento-shadow disabled:opacity-30"
          disabled={currentLearnNum === 1}
        >
          <RotateCcw size={32} className="rotate-180" />
        </button>
        <button 
          onClick={() => { playSound('click'); setCurrentLearnNum(Math.min(10, currentLearnNum + 1)); }}
          className="p-6 bg-blue-400 rounded-3xl text-white bento-border bento-shadow disabled:opacity-30"
          disabled={currentLearnNum === 10}
        >
          <Play size={32} />
        </button>
      </div>
    </motion.div>
  );

  const GameSelectScreen = () => (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="min-h-screen p-6 pb-20 flex flex-col items-center"
    >
       <header className="w-full flex justify-between items-center mb-12">
        <button onClick={() => { playSound('click'); setScreen('home'); }} className="p-4 bg-white rounded-2xl bento-border bento-shadow">
          <ArrowLeft size={32} />
        </button>
        <span className="text-3xl font-black text-[#333] uppercase tracking-tighter">Choose a Game</span>
        <div className="w-14 h-14" />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
        <motion.div
          whileHover={{ scale: 1.02, rotate: -1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('counting-game'); }}
          className="bg-pink-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
          <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('counting-game'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-pink-600" />
          </button>
          <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <Search size={64} className="text-pink-500" />
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">I SPY</h3>
            <p className="text-[#333] font-bold opacity-70">Find and count items!</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: 1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('memory-game'); }}
          className="bg-purple-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('memory-game'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-purple-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <Sparkles size={64} className="text-purple-500" />
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">MEMORY</h3>
            <p className="text-[#333] font-bold opacity-70">Match the pairs!</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: -1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('greater-less'); }}
          className="bg-blue-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('greater-less'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-blue-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <div className="text-6xl font-black text-blue-500 flex gap-2"><ArrowLeft /><ArrowLeft className="rotate-180"/></div>
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">BIG OR SMALL</h3>
            <p className="text-[#333] font-bold opacity-70">Pick the bigger one!</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: 1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('sequence-game'); }}
          className="bg-yellow-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('sequence-game'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-yellow-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <div className="text-5xl font-black text-yellow-600 flex gap-1">1, 2, ?</div>
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">SEQUENCE</h3>
            <p className="text-[#333] font-bold opacity-70">What comes next?</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: -1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('bubble-pop'); }}
          className="bg-green-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('bubble-pop'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-green-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full border-4 border-green-500 animate-pulse" />
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">POP IT</h3>
            <p className="text-[#333] font-bold opacity-70">Pop the bubbles!</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: 1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('pattern-match'); }}
          className="bg-indigo-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('pattern-match'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-indigo-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <div className="flex gap-2">🍎 ⭐ 🍎 ?</div>
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">PATTERNS</h3>
            <p className="text-[#333] font-bold opacity-70">Complete the line!</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, rotate: -1 }}
          onClick={() => { playSound('click'); incrementGamesPlayed(); setScreen('addition-game'); }}
          className="bg-orange-300 p-8 rounded-[40px] bento-border bento-shadow-lg flex flex-col items-center gap-6 cursor-pointer relative"
        >
           <button 
            onClick={(e) => { e.stopPropagation(); setInfoModal('addition-game'); playSound('click'); }}
            className="absolute top-4 right-4 p-3 bg-white/50 hover:bg-white rounded-2xl transition-colors bento-border"
          >
            <Info size={24} className="text-orange-600" />
          </button>
           <div className="w-full bg-white bento-border rounded-2xl p-6 flex items-center justify-center">
            <div className="text-6xl font-black text-orange-500">+</div>
          </div>
          <div className="text-center">
            <h3 className="text-3xl font-black text-[#333] uppercase">ADD UP</h3>
            <p className="text-[#333] font-bold opacity-70">Simple addition!</p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  const GreaterLessGame = () => {
    const [nums, setNums] = useState<[number, number]>([0, 0]);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

    const generateChallenge = () => {
      let n1 = Math.floor(Math.random() * 10) + 1;
      let n2 = Math.floor(Math.random() * 10) + 1;
      while(n1 === n2) n2 = Math.floor(Math.random() * 10) + 1;
      setNums([n1, n2]);
      setIsCorrect(null);
    };

    useEffect(() => {
      generateChallenge();
    }, []);

    const handleChoice = (num: number) => {
      if (num === Math.max(...nums)) {
        playSound('correct');
        setIsCorrect(true);
        setScore(s => s + 15);
        updateStats(15, true);
        setTimeout(generateChallenge, 1500);
      } else {
        playSound('wrong');
        setIsCorrect(false);
        updateStats(0, false);
        setTimeout(() => setIsCorrect(null), 1000);
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen p-6 flex flex-col items-center">
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow"><ArrowLeft size={24} /></button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow flex items-center gap-3">
            <Trophy className="text-yellow-500" size={24} /><span className="font-black text-blue-500 text-xl">{score}</span>
          </div>
        </header>

        <div className="bg-white w-full max-w-lg rounded-[48px] p-10 bento-border bento-shadow-lg flex-1 flex flex-col items-center">
          <h2 className="text-3xl font-black text-[#333] mb-12 text-center uppercase tracking-tighter">Which one is <span className="text-blue-500">BIGGER</span>?</h2>
          <div className="flex gap-8 w-full justify-center">
            {nums.map((n, i) => (
              <motion.button
                key={i}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleChoice(n)}
                className={`w-32 h-44 rounded-3xl bento-border bento-shadow-lg flex items-center justify-center text-7xl font-black transition-colors ${i === 0 ? 'bg-orange-400 text-white' : 'bg-blue-400 text-white'}`}
              >
                {n}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  const SequenceGame = () => {
    const [sequence, setSequence] = useState<number[]>([]);
    const [missingIdx, setMissingIdx] = useState(0);
    const [options, setOptions] = useState<number[]>([]);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

    const generateChallenge = () => {
      const start = Math.floor(Math.random() * 5) + 1;
      const seq = [start, start + 1, start + 2, start + 3];
      const mIdx = Math.floor(Math.random() * 4);
      setSequence(seq);
      setMissingIdx(mIdx);
      
      const correct = seq[mIdx];
      const opts = [correct];
      while(opts.length < 3) {
        const r = Math.floor(Math.random() * 10) + 1;
        if(!opts.includes(r)) opts.push(r);
      }
      setOptions(opts.sort(() => Math.random() - 0.5));
      setIsCorrect(null);
    };

    useEffect(() => {
      generateChallenge();
    }, []);

    const handleChoice = (num: number) => {
      if (num === sequence[missingIdx]) {
        playSound('correct');
        setIsCorrect(true);
        setScore(s => s + 20);
        updateStats(20, true);
        setTimeout(generateChallenge, 1500);
      } else {
        playSound('wrong');
        setIsCorrect(false);
        updateStats(0, false);
        setTimeout(() => setIsCorrect(null), 1000);
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen p-6 flex flex-col items-center">
         <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow"><ArrowLeft size={24} /></button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow flex items-center gap-3">
            <Trophy className="text-yellow-500" size={24} /><span className="font-black text-yellow-600 text-xl">{score}</span>
          </div>
        </header>

        <div className="bg-white w-full max-w-lg rounded-[48px] p-10 bento-border bento-shadow-lg flex-1 flex flex-col items-center">
          <h2 className="text-3xl font-black text-[#333] mb-12 text-center uppercase tracking-tighter">What is the <span className="text-yellow-500">MISSING</span> number?</h2>
          
          <div className="flex gap-4 mb-12">
            {sequence.map((n, i) => (
              <div key={i} className={`w-16 h-20 rounded-2xl bento-border bento-shadow-lg flex items-center justify-center text-3xl font-black ${i === missingIdx ? 'bg-yellow-100 text-yellow-500 border-dashed animate-pulse' : 'bg-gray-100 text-gray-400'}`}>
                {i === missingIdx ? '?' : n}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 w-full">
            {options.map(opt => (
              <motion.button
                key={opt}
                whileHover={{ scale: 1.05 }}
                onClick={() => handleChoice(opt)}
                className="p-6 bg-white rounded-[32px] text-4xl font-black bento-border bento-shadow"
              >
                {opt}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  const BubblePopGame = () => {
    const [targetNum, setTargetNum] = useState(0);
    const [bubbles, setBubbles] = useState<{ id: number, val: number, x: number, y: number }[]>([]);

    const spawnBubble = () => {
      const id = Date.now() + Math.random();
      const val = Math.floor(Math.random() * 10) + 1;
      const x = 10 + Math.random() * 80;
      setBubbles(prev => [...prev, { id, val, x, y: 110 }]);
    };

    useEffect(() => {
      setTargetNum(Math.floor(Math.random() * 10) + 1);
      const interval = setInterval(spawnBubble, 1500);
      const moveInterval = setInterval(() => {
        setBubbles(prev => prev.map(b => ({ ...b, y: b.y - 0.5 })).filter(b => b.y > -10));
      }, 16);
      return () => { clearInterval(interval); clearInterval(moveInterval); };
    }, []);

    const handlePop = (id: number, val: number) => {
      if (val === targetNum) {
        playSound('pop');
        setBubbles(prev => prev.filter(b => b.id !== id));
        setScore(s => s + 5);
        updateStats(5, true);
        setTargetNum(Math.floor(Math.random() * 10) + 1);
      } else {
        playSound('wrong');
        updateStats(0, false);
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen p-6 flex flex-col items-center overflow-hidden bg-green-50 relative">
        <header className="w-full flex justify-between items-center mb-8 z-20">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow"><ArrowLeft size={24} /></button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow flex flex-col items-center">
            <span className="text-xs font-black text-gray-400 uppercase">Pop the number:</span>
            <span className="text-4xl font-black text-green-500">{targetNum}</span>
          </div>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow font-black text-xl text-green-600">{score}</div>
        </header>

        <div className="flex-1 w-full relative">
          {bubbles.map(b => (
            <motion.button
              key={b.id}
              onClick={() => handlePop(b.id, b.val)}
              className="absolute w-16 h-16 rounded-full bg-white/40 bento-border border-white flex items-center justify-center text-2xl font-black text-green-600 shadow-inner backdrop-blur-sm"
              style={{ left: `${b.x}%`, top: `${b.y}%` }}
              whileTap={{ scale: 0.8 }}
            >
              {b.val}
            </motion.button>
          ))}
        </div>
      </motion.div>
    );
  };

  const PatternMatchGame = () => {
    const [pattern, setPattern] = useState<string[]>([]);
    const [options, setOptions] = useState<string[]>([]);
    const [answer, setAnswer] = useState("");

    const generateChallenge = () => {
      const items = ['🍎', '⭐', '🏀', '🐱', '🌸'];
      const i1 = items[Math.floor(Math.random() * items.length)];
      const i2 = items.filter(i => i !== i1)[Math.floor(Math.random() * (items.length - 1))];
      
      const p = [i1, i2, i1, i2];
      setPattern(p);
      setAnswer(i1);
      
      const opts = [i1, i2, items.find(i => i !== i1 && i !== i2)!];
      setOptions(opts.sort(() => Math.random() - 0.5));
    };

    useEffect(() => { generateChallenge(); }, []);

    const handleChoice = (choice: string) => {
      if (choice === answer) {
        playSound('correct');
        setScore(s => s + 25);
        updateStats(25, true);
        generateChallenge();
      } else {
        playSound('wrong');
        updateStats(0, false);
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen p-6 flex flex-col items-center bg-indigo-50">
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow"><ArrowLeft size={24} /></button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow font-black text-xl text-indigo-600">{score}</div>
        </header>

        <div className="bg-white w-full max-w-lg rounded-[48px] p-10 bento-border bento-shadow-lg flex-1 flex flex-col items-center justify-center">
          <h2 className="text-3xl font-black text-[#333] mb-12 text-center uppercase tracking-tighter">Complete the <span className="text-indigo-500">PATTERN</span></h2>
          
          <div className="flex gap-4 mb-16 text-6xl">
            {pattern.map((item, i) => <div key={i}>{item}</div>)}
            <div className="w-16 h-16 bento-border border-dashed border-indigo-300 rounded-xl flex items-center justify-center text-4xl animate-pulse">?</div>
          </div>

          <div className="flex gap-6">
            {options.map(opt => (
              <motion.button
                key={opt}
                whileHover={{ scale: 1.1 }}
                onClick={() => handleChoice(opt)}
                className="w-24 h-24 bg-white bento-border bento-shadow rounded-3xl text-5xl flex items-center justify-center"
              >
                {opt}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  const AdditionGame = () => {
    const [problem, setProblem] = useState({ n1: 0, n2: 0, sum: 0 });
    const [options, setOptions] = useState<number[]>([]);

    const generateChallenge = () => {
      const n1 = Math.floor(Math.random() * 5) + 1;
      const n2 = Math.floor(Math.random() * 4) + 1;
      const sum = n1 + n2;
      setProblem({ n1, n2, sum });

      const opts = [sum];
      while(opts.length < 3) {
        const r = Math.floor(Math.random() * 9) + 1;
        if(!opts.includes(r)) opts.push(r);
      }
      setOptions(opts.sort(() => Math.random() - 0.5));
    };

    useEffect(() => { generateChallenge(); }, []);

    const [correctCount, setCorrectCount] = useState(0);

    const handleChoice = (val: number) => {
      if (val === problem.sum) {
        playSound('correct');
        setScore(s => s + 30);
        updateStats(30, true);
        const newCount = correctCount + 1;
        setCorrectCount(newCount);
        if (newCount % 5 === 0) {
          triggerConfetti();
          submitScore('addition', 150); // 30 points * 5
        }
        generateChallenge();
      } else {
        playSound('wrong');
        updateStats(0, false);
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen p-6 flex flex-col items-center bg-orange-50">
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow"><ArrowLeft size={24} /></button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow font-black text-xl text-orange-600">{score}</div>
        </header>

        <div className="bg-white w-full max-w-lg rounded-[48px] p-10 bento-border bento-shadow-lg flex-1 flex flex-col items-center justify-center">
          <h2 className="text-3xl font-black text-[#333] mb-12 text-center uppercase tracking-tighter">Simple <span className="text-orange-500">ADDITION</span></h2>
          
          <div className="flex items-center gap-6 mb-16">
            <div className="flex flex-col items-center">
              <div className="flex gap-1 mb-2">
                {Array.from({ length: problem.n1 }).map((_, i) => <span key={i} className="text-3xl">🍎</span>)}
              </div>
              <div className="text-6xl font-black">{problem.n1}</div>
            </div>
            <div className="text-5xl font-black text-orange-500">+</div>
            <div className="flex flex-col items-center">
              <div className="flex gap-1 mb-2">
                {Array.from({ length: problem.n2 }).map((_, i) => <span key={i} className="text-3xl">🍎</span>)}
              </div>
              <div className="text-6xl font-black">{problem.n2}</div>
            </div>
            <div className="text-5xl font-black text-gray-300">=</div>
            <div className="w-20 h-24 bento-border border-dashed border-orange-300 rounded-3xl flex items-center justify-center text-5xl font-black text-orange-500 animate-pulse">?</div>
          </div>

          <div className="grid grid-cols-3 gap-6 w-full">
            {options.map(opt => (
              <motion.button
                key={opt}
                whileHover={{ scale: 1.05 }}
                onClick={() => handleChoice(opt)}
                className="p-8 bg-white bento-border bento-shadow rounded-3xl text-5xl font-black text-orange-600"
              >
                {opt}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  const CountingGame = () => {
    const [challenge, setChallenge] = useState<CountingChallenge | null>(null);
    const [options, setOptions] = useState<number[]>([]);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const [feedbackNum, setFeedbackNum] = useState<number | null>(null);

    const generateChallenge = () => {
      const num = Math.floor(Math.random() * 5) + 1; // 1-5 for kids
      const items = Object.keys(ITEM_ICONS);
      const item = items[Math.floor(Math.random() * items.length)];
      
      setChallenge({ number: num, item, icon: ITEM_ICONS[item] });
      
      const opts = [num];
      while(opts.length < 3) {
        const r = Math.floor(Math.random() * 8) + 1;
        if(!opts.includes(r)) opts.push(r);
      }
      setOptions(opts.sort(() => Math.random() - 0.5));
      setIsCorrect(null);
      setFeedbackNum(null);
    };

    useEffect(() => {
      generateChallenge();
    }, []);

    const handleChoice = (choice: number) => {
      if (choice === challenge?.number) {
        playSound('correct');
        setIsCorrect(true);
        setScore(s => s + 10);
        updateStats(10, true);
        triggerConfetti();
        setTimeout(generateChallenge, 1500);
      } else {
        playSound('wrong');
        setIsCorrect(false);
        setFeedbackNum(choice);
        updateStats(0, false);
        setTimeout(() => setIsCorrect(null), 1000);
      }
    };

    if(!challenge) return null;

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen p-6 flex flex-col items-center"
      >
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow">
            <ArrowLeft size={24} />
          </button>
          <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow flex items-center gap-3">
            <Trophy className="text-yellow-500" size={24} />
            <span className="font-black text-pink-500 text-xl">{score}</span>
          </div>
        </header>

        <div className="bg-white w-full max-w-lg rounded-[48px] p-10 bento-border bento-shadow-lg flex-1 flex flex-col items-center">
          <h2 className="text-3xl font-black text-[#333] mb-10 text-center uppercase tracking-tighter">
            How many <span className="text-pink-500">{challenge.item}s</span>?
          </h2>

          <div className="flex-1 flex flex-wrap justify-center items-center gap-8 content-center max-w-xs">
            {Array.from({ length: challenge.number }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: [0, 5, -5, 0] }}
                transition={{ delay: i * 0.1, rotate: { repeat: Infinity, duration: 2, delay: i * 0.2 } }}
                className="text-7xl drop-shadow-sm"
              >
                {challenge.icon}
              </motion.div>
            ))}
          </div>

          <div className="mt-12 grid grid-cols-3 gap-6 w-full">
            {options.map((opt) => (
              <motion.button
                key={opt}
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleChoice(opt)}
                className={`
                  p-6 rounded-[32px] text-4xl font-black bento-border bento-shadow transition-all
                  ${isCorrect && opt === challenge.number ? 'bg-green-400 text-white' : 
                    feedbackNum === opt && !isCorrect ? 'bg-red-400 text-white' :
                    'bg-white text-gray-800'}
                `}
                disabled={isCorrect === true}
              >
                {opt}
              </motion.button>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {isCorrect && (
            <motion.div
              initial={{ scale: 0, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              className="fixed bottom-20 bg-green-500 text-white px-8 py-4 rounded-full font-black text-2xl shadow-2xl z-50 flex items-center gap-3"
            >
              <Sparkles /> AMAZING! <Sparkles />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  const MemoryGame = () => {
    const [cards, setCards] = useState<{ id: number, val: number, isFlipped: boolean, isMatched: boolean }[]>([]);
    const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [hintsLeft, setHintsLeft] = useState(3);
    const [isHinting, setIsHinting] = useState(false);

    const resetGame = () => {
      playSound('click');
      const vals = [1, 2, 3, 4, 1, 2, 3, 4]; // 4 pairs
      const shuffled = vals
        .sort(() => Math.random() - 0.5)
        .map((v, i) => ({ id: i, val: v, isFlipped: false, isMatched: false }));
      setCards(shuffled);
      setFlippedIndices([]);
      setHintsLeft(3);
      setIsProcessing(false);
      setIsHinting(false);
    };

    useEffect(() => {
      resetGame();
    }, []);

    const useHint = () => {
      if (hintsLeft > 0 && !isHinting && !isProcessing) {
        playSound('click');
        setHintsLeft(h => h - 1);
        setIsHinting(true);
        setTimeout(() => setIsHinting(false), 1500);
      }
    };

    const handleCardClick = (idx: number) => {
      if (isProcessing || isHinting || cards[idx].isFlipped || cards[idx].isMatched || flippedIndices.includes(idx)) return;

      playSound('click');
      const newIndices = [...flippedIndices, idx];
      setFlippedIndices(newIndices);

      if (newIndices.length === 2) {
        setIsProcessing(true);
        const [first, second] = newIndices;
        
        if (cards[first].val === cards[second].val) {
          playSound('correct');
          setTimeout(() => {
            setCards(prev => prev.map((c, i) => 
              (i === first || i === second) ? { ...c, isMatched: true } : c
            ));
            setFlippedIndices([]);
            setIsProcessing(false);
            setScore(s => s + 20);
            updateStats(20, true);
            
            // Check for win
            setCards(currentCards => {
              const updated = currentCards.map((c, i) => 
                (i === first || i === second) ? { ...c, isMatched: true } : c
              );
              if (updated.every(c => c.isMatched)) {
                triggerConfetti();
                submitScore('memory', score + 20); // Submit current score for the game
              }
              return currentCards;
            });
          }, 800);
        } else {
          playSound('wrong');
          setTimeout(() => {
            setFlippedIndices([]);
            setIsProcessing(false);
            setScore(s => Math.max(0, s - 5));
            updateStats(0, false);
          }, 1200);
        }
      }
    };

    const isWinner = cards.length > 0 && cards.every(c => c.isMatched);

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen p-6 flex flex-col items-center"
      >
        <header className="w-full flex justify-between items-center mb-8">
          <button onClick={() => setScreen('game-select')} className="p-4 bg-white rounded-2xl bento-border bento-shadow">
            <ArrowLeft size={24} />
          </button>
          
          <div className="flex gap-4">
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={resetGame}
              className="p-4 bg-white rounded-2xl bento-border bento-shadow text-gray-600"
              title="Reset Game"
            >
              <RotateCcw size={24} />
            </motion.button>

            <motion.button 
              whileHover={hintsLeft > 0 ? { scale: 1.05 } : {}}
              whileTap={hintsLeft > 0 ? { scale: 0.95 } : {}}
              onClick={useHint}
              disabled={hintsLeft === 0 || isHinting || isProcessing}
              className={`bg-white px-6 py-3 rounded-full bento-border bento-shadow flex items-center gap-2 ${hintsLeft === 0 ? 'opacity-50 grayscale' : ''}`}
            >
              <Sparkles className="text-yellow-500" size={24} />
              <span className="font-black text-gray-700 text-xl">{hintsLeft}</span>
            </motion.button>

            <div className="bg-white px-8 py-3 rounded-full bento-border bento-shadow flex items-center gap-3">
              <Star className="text-purple-500" size={24} />
              <span className="font-black text-purple-700 text-xl">MATCH!</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-6 max-w-md w-full mt-8">
          {cards.map((card, i) => (
            <motion.div
              key={card.id}
              onClick={() => handleCardClick(i)}
              whileHover={!isHinting ? { scale: 1.05, y: -4 } : {}}
              animate={{ rotateY: card.isMatched || flippedIndices.includes(i) || isHinting ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className={`
                aspect-square rounded-[32px] cursor-pointer relative preserve-3d
                ${card.isMatched ? 'opacity-30' : ''}
              `}
              style={{ transformStyle: 'preserve-3d' }}
            >
              {/* Back of card */}
              <div className="absolute inset-0 bg-purple-400 rounded-[32px] flex items-center justify-center bento-border bento-shadow backface-hidden">
                <Sparkles className="text-white opacity-40" size={48} />
              </div>
              
              {/* Front of card */}
              <div 
                className="absolute inset-0 bg-white rounded-[32px] flex items-center justify-center bento-border bento-shadow backface-hidden"
                style={{ transform: 'rotateY(180deg)' }}
              >
                <span className="text-6xl font-black text-purple-600">{card.val}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {isWinner && (
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="mt-12 text-center"
          >
            <h2 className="text-5xl font-black text-[#333] mb-6 tracking-tighter uppercase">YOU WIN!</h2>
            <button 
              onClick={() => {
                setCards(prev => prev.map(c => ({ ...c, isMatched: false, isFlipped: false })).sort(() => Math.random() - 0.5));
                setFlippedIndices([]);
              }}
              className="bg-blue-400 text-white px-10 py-5 rounded-[32px] font-black text-2xl bento-border bento-shadow-lg flex items-center gap-3 mx-auto"
            >
              <RotateCcw size={28} /> Play Again
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="font-sans antialiased overflow-hidden select-none">
      <AnimatePresence mode="wait">
        {screen === 'home' && <HomeScreen key="home" />}
        {screen === 'learn' && <LearnScreen key="learn" />}
        {screen === 'game-select' && <GameSelectScreen key="game-select" />}
        {screen === 'stats' && <StatsScreen key="stats" />}
        {screen === 'counting-game' && <CountingGame key="counting" />}
        {screen === 'memory-game' && <MemoryGame key="memory" />}
        {screen === 'greater-less' && <GreaterLessGame key="greater-less" />}
        {screen === 'sequence-game' && <SequenceGame key="sequence" />}
        {screen === 'bubble-pop' && <BubblePopGame key="bubble-pop" />}
        {screen === 'pattern-match' && <PatternMatchGame key="pattern-match" />}
        {screen === 'addition-game' && <AdditionGame key="addition" />}
      </AnimatePresence>
      <AnimatePresence>
        {infoModal && <GameInfoModal game={infoModal} />}
      </AnimatePresence>
      
      {/* Decorative blobs */}
      <div className="fixed -z-10 top-0 left-0 w-64 h-64 bg-orange-200/20 blur-[100px] rounded-full" />
      <div className="fixed -z-10 bottom-0 right-0 w-96 h-96 bg-blue-200/20 blur-[120px] rounded-full" />
    </div>
  );
}
