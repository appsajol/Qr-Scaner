
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
  ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScannedRecord, ScanSession, ScanTarget } from './types.ts';
import { ScannerOverlay } from './components/ScannerOverlay.tsx';
import { analyzeScanPair } from './services/geminiService.ts';
import { supabase } from './services/supabaseClient.ts';

const SCANNER_ID = "qr-reader";

type AppView = 'scan' | 'history';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>('scan');
  const [records, setRecords] = useState<ScannedRecord[]>([]);
  const [session, setSession] = useState<ScanSession>({ partNumber: null, uniqueCode: null });
  const [isScanning, setIsScanning] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ScanTarget>(ScanTarget.PART_NUMBER);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const fetchRecords = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

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
    setError(null);
    await stopScanner();
    
    setActiveTarget(target);
    setIsScanning(true);
    
    setTimeout(async () => {
      const container = document.getElementById(SCANNER_ID);
      if (!container) {
        setIsScanning(false);
        setError("Scanner area loading error.");
        return;
      }

      try {
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;
        
        // Correcting the config for small QR codes
        const config = { 
          fps: 25,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.floor(minEdge * 0.75);
            return { width: boxSize, height: boxSize };
          },
          aspectRatio: 1.0,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          },
          // Resolution hints are passed here in some versions, but mostly 
          // we rely on the library to pick the best stream for the chosen facingMode.
          videoConstraints: {
             width: { ideal: 1280 },
             height: { ideal: 720 }
          }
        };
        
        // FIX: The first argument must have EXACTLY 1 KEY if passed as an object
        const cameraConfig = { facingMode: "environment" };

        await scanner.start(
          cameraConfig,
          config,
          (decodedText) => {
            const cleaned = decodedText.trim();
            setSession(prev => ({ ...prev, [target]: cleaned }));
            stopScanner();
          },
          () => {} 
        );
      } catch (err: any) {
        console.error("Camera Initial Attempt Error:", err);
        
        // Before fallback, completely clear the state to avoid transition errors
        if (scannerRef.current) {
           try { await scannerRef.current.clear(); } catch(e) {}
        }
        
        // Wait a small frame to ensure DOM and camera driver are ready for a new attempt
        await new Promise(r => setTimeout(r, 500));

        try {
          if (scannerRef.current) {
            await scannerRef.current.start(
              { facingMode: "environment" },
              { fps: 15, qrbox: { width: 250, height: 250 } },
              (decodedText) => {
                const cleaned = decodedText.trim();
                setSession(prev => ({ ...prev, [target]: cleaned }));
                stopScanner();
              },
              () => {}
            );
          }
        } catch (fallbackErr: any) {
          console.error("Camera Fallback Error:", fallbackErr);
          let msg = "ক্যামেরা এক্সেস করা যায়নি।";
          
          if (fallbackErr.name === 'NotAllowedError' || fallbackErr.message?.includes('Permission')) {
            msg = "ক্যামেরা পারমিশন দেওয়া হয়নি। ব্রাউজার সেটিং থেকে ক্যামেরা এলাউ করুন।";
          } else if (fallbackErr.name === 'NotFoundError') {
            msg = "আপনার ডিভাইসে কোনো ক্যামেরা খুঁজে পাওয়া যায়নি।";
          } else if (fallbackErr.name === 'NotReadableError') {
            msg = "ক্যামেরা অন্য কোনো অ্যাপে ব্যবহৃত হচ্ছে।";
          }
          
          setError(msg);
          setIsScanning(false);
        }
      }
    }, 400); // Increased delay for stability
  }, [stopScanner]);

  const generateId = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch (e) {
      return `id-${Date.now()}`;
    }
  };

  const handleSave = async () => {
    if (!session.partNumber || !session.uniqueCode) {
      setError("দয়া করে দুটি কোডই স্ক্যান করুন।");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const { data: existing } = await supabase
        .from('scanned_records')
        .select('id')
        .eq('unique_code', session.uniqueCode)
        .maybeSingle();

      if (existing) {
        setError(`ডুপ্লিকেট কোড: এই সিরিয়ালটি ইতিপূর্বে ব্যবহৃত হয়েছে।`);
        setIsAnalyzing(false);
        return;
      }

      const analysis = await analyzeScanPair(session.partNumber, session.uniqueCode);
      
      const newRecordData = {
        id: generateId(),
        part_number: session.partNumber,
        unique_code: session.uniqueCode,
        timestamp: new Date().toISOString(),
        analysis
      };

      const { error: insertErr } = await supabase
        .from('scanned_records')
        .insert([newRecordData]);

      if (insertErr) throw insertErr;

      setRecords(prev => [{
        id: newRecordData.id,
        partNumber: newRecordData.part_number,
        uniqueCode: newRecordData.unique_code,
        timestamp: newRecordData.timestamp,
        status: 'synced' as const,
        analysis: newRecordData.analysis
      }, ...prev]);

      setSession({ partNumber: null, uniqueCode: null });
      setSuccess("সফলভাবে সেভ করা হয়েছে।");
    } catch (err) {
      console.error("Save error:", err);
      setError("ডেটা ক্লাউডে পাঠাতে সমস্যা হয়েছে। ইন্টারনেট চেক করুন।");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("আপনি কি নিশ্চিতভাবে এই রেকর্ডটি মুছতে চান?")) return;
    
    try {
      const { error: delErr } = await supabase
        .from('scanned_records')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;
      setRecords(prev => prev.filter(r => r.id !== id));
      setSuccess("রেকর্ডটি মুছে ফেলা হয়েছে।");
    } catch (err) {
      console.error("Delete error:", err);
      setError("রেকর্ড মুছতে সমস্যা হয়েছে।");
    }
  };

  const exportToExcel = () => {
    try {
      const ws = XLSX.utils.json_to_sheet(records.map(r => ({
        'Part Number': r.partNumber,
        'Unique Serial': r.uniqueCode,
        'Date & Time': new Date(r.timestamp).toLocaleString(),
        'Verification': r.analysis
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scanned Records");
      XLSX.writeFile(wb, `XtraPro_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      setSuccess("Report generated.");
    } catch (err) {
      setError("Error creating report.");
    }
  };

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
          <div className="flex bg-slate-800 p-1 rounded-xl">
            <button 
              onClick={() => setCurrentView('scan')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${currentView === 'scan' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Scan
            </button>
            <button 
              onClick={() => setCurrentView('history')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${currentView === 'history' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              History
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto pt-20 pb-24 px-4">
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
                  <button 
                    onClick={stopScanner}
                    className="absolute top-4 right-4 z-20 w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors border border-white/10"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => startScanner(ScanTarget.PART_NUMBER)}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                      session.partNumber 
                        ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400' 
                        : activeTarget === ScanTarget.PART_NUMBER && isScanning
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse'
                          : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">
                      {session.partNumber ? <CheckCircle className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Part Number</span>
                    <span className="text-xs font-mono truncate max-w-full font-bold">
                      {session.partNumber || "Pending..."}
                    </span>
                  </button>

                  <button
                    onClick={() => startScanner(ScanTarget.UNIQUE_CODE)}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                      session.uniqueCode 
                        ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400' 
                        : activeTarget === ScanTarget.UNIQUE_CODE && isScanning
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400 animate-pulse'
                          : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">
                      {session.uniqueCode ? <CheckCircle className="w-5 h-5" /> : <Hash className="w-5 h-5" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Unique Serial</span>
                    <span className="text-xs font-mono truncate max-w-full font-bold">
                      {session.uniqueCode || "Pending..."}
                    </span>
                  </button>
                </div>

                <button
                  onClick={handleSave}
                  disabled={!session.partNumber || !session.uniqueCode || isAnalyzing}
                  className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:grayscale rounded-2xl font-black text-white shadow-xl shadow-blue-900/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98] uppercase tracking-widest text-sm"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Save Scan Pair
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/50 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 text-slate-400">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="text-[10px] uppercase font-bold tracking-wider">
                  <p className="text-slate-300">Cloud Sync Enabled</p>
                  <p className="opacity-50">Secure Validation</p>
                </div>
              </div>
              <button onClick={() => setSession({partNumber: null, uniqueCode: null})} className="text-[10px] font-black uppercase text-slate-500 hover:text-red-400 transition-colors">
                Reset
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                History
              </h2>
              <button
                onClick={exportToExcel}
                disabled={records.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-xs font-semibold transition-colors border border-slate-700"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Export
              </button>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm font-medium tracking-wide">Syncing...</p>
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-600 border border-dashed border-slate-800 rounded-3xl bg-slate-900/30">
                <Scan className="w-12 h-12 opacity-10" />
                <p className="text-sm font-medium">No records found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {records.map((record, idx) => (
                  <div key={record.id} className="group bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-blue-500/30 transition-all relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-600/50" />
                    <div className="flex items-start justify-between mb-3 pl-1">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black uppercase tracking-tighter text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">PART</span>
                          <span className="font-mono text-sm font-bold tracking-tight">{record.partNumber}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black uppercase tracking-tighter text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">SERIAL</span>
                          <span className="font-mono text-xs text-slate-300 tracking-tight">{record.uniqueCode}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDelete(record.id)}
                        className="p-2 text-slate-700 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {record.analysis && (
                      <div className="text-[11px] text-slate-400 bg-black/30 rounded-xl p-3 border border-slate-800/50 mb-3 leading-relaxed">
                        <p className="opacity-80 leading-snug"><span className="text-blue-400 font-bold mr-1">AI:</span>{record.analysis}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-widest pl-1">
                      <span>{new Date(record.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 z-50 px-10 pb-8 pt-4 flex items-center justify-around">
        <button onClick={() => setCurrentView('scan')} className={`flex flex-col items-center gap-1.5 transition-all ${currentView === 'scan' ? 'text-blue-500' : 'text-slate-500'}`}>
          <Scan className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Scanner</span>
        </button>
        <button onClick={() => setCurrentView('history')} className={`flex flex-col items-center gap-1.5 transition-all ${currentView === 'history' ? 'text-blue-500' : 'text-slate-500'}`}>
          <History className="w-6 h-6" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">Records</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
