
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Package, 
  Hash, 
  Trash2, 
  FileSpreadsheet, 
  CheckCircle2, 
  Camera, 
  History, 
  AlertCircle,
  X,
  Loader2,
  RefreshCw,
  ScanLine,
  CheckCircle,
  Scan,
  Database,
  ArrowRight,
  Cloud,
  Lock,
  LogOut,
  ShieldCheck,
  ChevronRight,
  Delete,
  ShieldAlert
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScannedRecord, ScanSession, ScanTarget } from './types.ts';
import { ScannerOverlay } from './components/ScannerOverlay.tsx';
import { analyzeScanPair } from './services/geminiService.ts';
import { supabase } from './services/supabaseClient.ts';

const SCANNER_ID = "qr-reader";
const REQUIRED_PIN = "779966";
const AUTH_STORAGE_KEY = "xtrapro_auth_token";

type AppView = 'scan' | 'history';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [pinEntry, setPinEntry] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [currentView, setCurrentView] = useState<AppView>('scan');
  const [records, setRecords] = useState<ScannedRecord[]>([]);
  const [session, setSession] = useState<ScanSession>({ partNumber: null, uniqueCode: null });
  const [isScanning, setIsScanning] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ScanTarget>(ScanTarget.PART_NUMBER);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Authorization Check
  useEffect(() => {
    const savedToken = localStorage.getItem(AUTH_STORAGE_KEY);
    if (savedToken === 'authorized') {
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
    setIsAuthLoading(false);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handlePinInput = (val: string) => {
    if (pinEntry.length < 6) {
      const newPin = pinEntry + val;
      setPinEntry(newPin);
      setError(null);
      
      if (newPin.length === 6) {
        if (newPin === REQUIRED_PIN) {
          localStorage.setItem(AUTH_STORAGE_KEY, 'authorized');
          setIsAuthorized(true);
          setPinEntry('');
        } else {
          setError("Invalid Authorization PIN");
          setTimeout(() => setPinEntry(''), 500);
        }
      }
    }
  };

  const clearPin = () => setPinEntry('');
  const deleteLastDigit = () => setPinEntry(prev => prev.slice(0, -1));

  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthorized(false);
    setCurrentView('scan');
    setSession({ partNumber: null, uniqueCode: null });
  };

  const fetchRecords = useCallback(async () => {
    if (!isAuthorized) return;
    setIsLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('scanned_records')
        .select('*')
        .order('timestamp', { ascending: false });

      if (fetchErr) throw fetchErr;
      
      const mappedData: ScannedRecord[] = (data || []).map(item => ({
        id: item.id,
        partNumber: item.part_number,
        uniqueCode: item.unique_code,
        timestamp: item.timestamp,
        status: 'synced',
        analysis: item.analysis
      }));
      
      setRecords(mappedData);
    } catch (err) {
      console.error("Supabase fetch error:", err);
      setError("ডেটা লোড করতে সমস্যা হয়েছে।");
    } finally {
      setIsLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (isAuthorized) fetchRecords();
  }, [isAuthorized, fetchRecords]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.warn("Scanner cleanup warning:", e);
      } finally {
        scannerRef.current = null;
        setIsScanning(false);
      }
    }
  }, []);

  const startScanner = useCallback(async (target: ScanTarget) => {
    if (isTransitioning) return;
    setError(null);
    setIsTransitioning(true);
    
    try {
      await stopScanner();
      setActiveTarget(target);
      setIsScanning(true);
      
      await new Promise(r => setTimeout(r, 400));
      
      const container = document.getElementById(SCANNER_ID);
      if (!container) throw new Error("Scanner container not found");

      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      
      let backCameraId = "";
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const backCamera = cameras.find(c => 
            c.label.toLowerCase().includes('back') || 
            c.label.toLowerCase().includes('rear') ||
            c.label.toLowerCase().includes('environment')
          );
          backCameraId = backCamera ? backCamera.id : cameras[cameras.length - 1].id;
        }
      } catch (e) {
        console.warn("Error enumerating cameras:", e);
      }

      const config = { 
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const boxSize = Math.floor(minEdge * 0.75);
          return { width: boxSize, height: boxSize };
        },
        aspectRatio: 1.0
      };
      
      const cameraIdOrConfig = backCameraId ? backCameraId : { facingMode: "environment" };

      await scanner.start(
        cameraIdOrConfig,
        config,
        (decodedText) => {
          setSession(prev => ({ ...prev, [target]: decodedText.trim() }));
          stopScanner();
        },
        () => {} 
      );
    } catch (err: any) {
      setError(err.message || "ক্যামেরা এক্সেস করা যায়নি।");
      setIsScanning(false);
      await stopScanner();
    } finally {
      setIsTransitioning(false);
    }
  }, [stopScanner, isTransitioning]);

  const handleSave = async () => {
    if (!session.partNumber || !session.uniqueCode) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const { data: existing } = await supabase.from('scanned_records').select('id').eq('unique_code', session.uniqueCode).maybeSingle();
      if (existing) {
        setError("ডুপ্লিকেট কোড: এই সিরিয়ালটি ইতিমধ্যে ব্যবহৃত হয়েছে।");
        setIsAnalyzing(false);
        return;
      }
      const analysis = await analyzeScanPair(session.partNumber, session.uniqueCode);
      const newRecordData = {
        id: crypto.randomUUID(),
        part_number: session.partNumber,
        unique_code: session.uniqueCode,
        timestamp: new Date().toISOString(),
        analysis
      };
      const { error: insertErr } = await supabase.from('scanned_records').insert([newRecordData]);
      if (insertErr) throw insertErr;
      setRecords(prev => [{
        id: newRecordData.id,
        partNumber: newRecordData.part_number,
        uniqueCode: newRecordData.unique_code,
        timestamp: newRecordData.timestamp,
        status: 'synced',
        analysis: newRecordData.analysis
      }, ...prev]);
      setSession({ partNumber: null, uniqueCode: null });
      setSuccess("সফলভাবে সেভ করা হয়েছে।");
    } catch (err) {
      setError("ডেটা সেভ করতে সমস্যা হয়েছে।");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("আপনি কি নিশ্চিতভাবে মুছতে চান?")) return;
    try {
      const { error: delErr } = await supabase.from('scanned_records').delete().eq('id', id);
      if (delErr) throw delErr;
      setRecords(prev => prev.filter(r => r.id !== id));
      setSuccess("মুছে ফেলা হয়েছে।");
    } catch (err) {
      setError("রেকর্ড মুছতে সমস্যা হয়েছে।");
    }
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'Part Number': r.partNumber,
      'Unique Serial': r.uniqueCode,
      'Date & Time': new Date(r.timestamp).toLocaleString(),
      'Verification': r.analysis
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scanned Records");
    XLSX.writeFile(wb, `XtraPro_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Security Check...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-blue-600/5 blur-[150px] rounded-full animate-pulse" />
        
        <div className="w-full max-w-sm space-y-10 relative z-10">
          <div className="text-center space-y-2">
            <div className="w-20 h-20 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-blue-900/40 mx-auto mb-6 ring-8 ring-blue-500/10 transition-transform hover:scale-105 duration-500">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter text-white">XtraPro AI</h1>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em]">System Authorization Required</p>
          </div>

          <div className="space-y-8">
            {/* PIN Display */}
            <div className="flex justify-center gap-3">
              {[...Array(6)].map((_, i) => (
                <div 
                  key={i} 
                  className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 ${
                    pinEntry.length > i 
                      ? 'border-blue-500 bg-blue-500/10 scale-105 shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
                      : error 
                        ? 'border-red-500/50 bg-red-500/5' 
                        : 'border-slate-800 bg-slate-900/50'
                  }`}
                >
                  {pinEntry.length > i && (
                    <div className="w-2.5 h-2.5 bg-white rounded-full animate-in zoom-in" />
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div className="text-center animate-in fade-in slide-in-from-top-1">
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full text-[10px] font-black uppercase tracking-widest text-red-400">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {error}
                </span>
              </div>
            )}

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-4 max-w-[280px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handlePinInput(num.toString())}
                  className="w-full aspect-square bg-slate-900/40 border border-white/5 hover:border-blue-500/30 hover:bg-slate-800/60 active:scale-95 text-xl font-black rounded-2xl transition-all"
                >
                  {num}
                </button>
              ))}
              <button 
                onClick={clearPin}
                className="w-full aspect-square text-slate-500 hover:text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => handlePinInput('0')}
                className="w-full aspect-square bg-slate-900/40 border border-white/5 hover:border-blue-500/30 hover:bg-slate-800/60 active:scale-95 text-xl font-black rounded-2xl transition-all"
              >
                0
              </button>
              <button 
                onClick={deleteLastDigit}
                className="w-full aspect-square flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
              >
                <Delete className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="text-center">
            <p className="text-[9px] text-slate-700 font-black uppercase tracking-[0.2em]">Enter Admin/Operator PIN to start</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
              <ScanLine className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">XtraPro AI</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 rounded-full border border-slate-700/50">
               <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
               <Cloud className={`w-3.5 h-3.5 ${isOnline ? 'text-blue-400' : 'text-slate-500'}`} />
            </div>
            <button 
              onClick={handleLogout}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 hover:bg-red-900/30 hover:text-red-400 transition-all border border-slate-700"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto pt-20 pb-20 px-4">
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-red-200/90 leading-tight">{error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div className="text-sm text-emerald-200/90">{success}</div>
          </div>
        )}

        {currentView === 'scan' ? (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative">
              <div className="aspect-square bg-black relative flex items-center justify-center">
                {isScanning ? (
                  <div id={SCANNER_ID} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-4 text-slate-600">
                    <Camera className="w-16 h-16 stroke-1 opacity-20" />
                    <p className="text-sm font-medium uppercase tracking-widest opacity-40">Ready to Scan</p>
                  </div>
                )}
                {isScanning && <ScannerOverlay activeTarget={activeTarget} isScanning={isScanning} />}
                {isScanning && (
                  <button onClick={stopScanner} className="absolute top-4 right-4 z-20 w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10"><X className="w-5 h-5" /></button>
                )}
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => startScanner(ScanTarget.PART_NUMBER)}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${session.partNumber ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400' : activeTarget === ScanTarget.PART_NUMBER && isScanning ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse' : 'border-slate-800 bg-slate-800/50 text-slate-400'}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">{session.partNumber ? <CheckCircle className="w-5 h-5" /> : <Package className="w-5 h-5" />}</div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Part</span>
                    <span className="text-xs font-mono truncate max-w-full font-bold">{session.partNumber || "Pending"}</span>
                  </button>
                  <button
                    onClick={() => startScanner(ScanTarget.UNIQUE_CODE)}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${session.uniqueCode ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400' : activeTarget === ScanTarget.UNIQUE_CODE && isScanning ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse' : 'border-slate-800 bg-slate-800/50 text-slate-400'}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">{session.uniqueCode ? <CheckCircle className="w-5 h-5" /> : <Hash className="w-5 h-5" />}</div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Serial</span>
                    <span className="text-xs font-mono truncate max-w-full font-bold">{session.uniqueCode || "Pending"}</span>
                  </button>
                </div>
                <button
                  onClick={handleSave}
                  disabled={!session.partNumber || !session.uniqueCode || isAnalyzing}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 rounded-2xl font-black text-white shadow-xl shadow-blue-900/20 transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-sm"
                >
                  {isAnalyzing ? <><Loader2 className="w-5 h-5 animate-spin" />Analyzing...</> : <><CheckCircle2 className="w-5 h-5" />Pair & Record</>}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Ledger</h2>
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{records.length} Total</p>
                </div>
              </div>
              <button onClick={exportToExcel} disabled={records.length === 0} className="flex items-center gap-2 px-4 py-2 bg-emerald-600/10 hover:bg-emerald-600/20 disabled:opacity-30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-emerald-500/20 text-emerald-400"><FileSpreadsheet className="w-4 h-4" />Export</button>
            </div>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500"><Loader2 className="w-8 h-8 animate-spin" /><p className="text-sm font-medium">Syncing Ledger...</p></div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-600 border border-dashed border-slate-800 rounded-[32px] bg-slate-900/20"><Scan className="w-12 h-12 opacity-10" /><p className="text-xs font-bold uppercase tracking-widest opacity-40">No records found</p></div>
            ) : (
              <div className="space-y-1">
                {records.map((record, idx) => (
                  <div key={record.id} className="group relative bg-slate-900/40 border-b border-slate-800/50 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 hover:bg-slate-900 transition-colors">
                    <div className="flex items-center p-3.5 gap-4">
                      <div className="w-8 shrink-0 text-[10px] font-black text-slate-600 font-mono">{(records.length - idx).toString().padStart(3, '0')}</div>
                      <div className="flex-1 min-w-0">
                         <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-mono text-xs font-bold text-slate-200 truncate">{record.partNumber}</span>
                            <ArrowRight className="w-3 h-3 text-slate-600" />
                            <span className="font-mono text-xs font-bold text-blue-400 truncate">{record.uniqueCode}</span>
                         </div>
                         <div className="flex items-center gap-3">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">{new Date(record.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            {record.analysis && <span className="text-[9px] font-bold text-blue-300/60 truncate max-w-[150px]">{record.analysis}</span>}
                         </div>
                      </div>
                      <button onClick={() => handleDelete(record.id)} className="p-2 text-slate-700 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 z-50 px-8 py-2 flex items-center justify-around h-16 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]">
        <button onClick={() => setCurrentView('scan')} className={`flex flex-col items-center gap-0.5 transition-all flex-1 ${currentView === 'scan' ? 'text-blue-500' : 'text-slate-500'}`}>
          <div className={`w-10 h-7 rounded-full flex items-center justify-center transition-all ${currentView === 'scan' ? 'bg-blue-500/10' : ''}`}><Scan className="w-5 h-5" /></div>
          <span className="text-[9px] font-black uppercase tracking-[0.1em]">Scanner</span>
        </button>
        <button onClick={() => setCurrentView('history')} className={`flex flex-col items-center gap-0.5 transition-all flex-1 ${currentView === 'history' ? 'text-blue-500' : 'text-slate-500'}`}>
          <div className={`w-10 h-7 rounded-full flex items-center justify-center transition-all ${currentView === 'history' ? 'bg-blue-500/10' : ''}`}><Database className="w-5 h-5" /></div>
          <span className="text-[9px] font-black uppercase tracking-[0.1em]">Ledger</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
