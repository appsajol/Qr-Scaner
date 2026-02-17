
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
        console.warn("Cleanup error:", e);
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
        
        const config = { 
          fps: 30,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.floor(minEdge * 0.65);
            return { width: boxSize, height: boxSize };
          },
          aspectRatio: 1.0,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        };
        
        const constraints: MediaTrackConstraints = { 
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        };

        await scanner.start(
          constraints,
          config,
          (decodedText) => {
            const cleaned = decodedText.trim();
            setSession(prev => ({ ...prev, [target]: cleaned }));
            stopScanner();
          },
          () => {} 
        );
      } catch (err: any) {
        console.error("Camera Error:", err);
        let msg = "ক্যামেরা এক্সেস করা যায়নি।";
        if (err.name === 'NotAllowedError') msg = "ক্যামেরা পারমিশন ডিনাইড। ব্রাউজার সেটিং চেক করুন।";
        else if (err.name === 'NotReadableError') msg = "ক্যামেরা অন্য কোথাও ব্যবহৃত হচ্ছে।";
        
        setError(msg);
        setIsScanning(false);
      }
    }, 250);
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
        setError(`ডুপ্লিকেট কোড: ইতিপূর্বে ব্যবহৃত হয়েছে।`);
        setIsAnalyzing(false);
        return;
      }

      // Fix: Complete the truncated logic for Gemini analysis and Supabase insertion
      const analysis = await analyzeScanPair(session.partNumber, session.uniqueCode);
      
      const newRecord = {
        id: generateId(),
        part_number: session.partNumber,
        unique_code: session.uniqueCode,
        timestamp: new Date().toISOString(),
        analysis
      };

      const { error: insertErr } = await supabase
        .from('scanned_records')
        .insert([newRecord]);

      if (insertErr) throw insertErr;

      setRecords(prev => [{
        id: newRecord.id,
        partNumber: newRecord.part_number,
        uniqueCode: newRecord.unique_code,
        timestamp: newRecord.timestamp,
        status: 'synced' as const,
        analysis: newRecord.analysis
      }, ...prev]);

      setSession({ partNumber: null, uniqueCode: null });
      setSuccess("ডেটা সফলভাবে সংরক্ষিত হয়েছে।");
    } catch (err) {
      console.error("Save error:", err);
      setError("ডেটা সংরক্ষণ করতে সমস্যা হয়েছে।");
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
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'Part Number': r.partNumber,
      'Unique Code': r.uniqueCode,
      'Timestamp': new Date(r.timestamp).toLocaleString(),
      'Analysis': r.analysis
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scans");
    XLSX.writeFile(wb, `manufacturing_scans_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
              <ScanLine className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">FactoryScan AI</h1>
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
            <div className="flex-1 text-sm text-red-200/90">{error}</div>
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
                  <div className="flex flex-col items-center gap-4 text-slate-500">
                    <Camera className="w-16 h-16 stroke-1 opacity-20" />
                    <p className="text-sm font-medium">Camera Inactive</p>
                  </div>
                )}
                {isScanning && <ScannerOverlay activeTarget={activeTarget} isScanning={isScanning} />}
                
                {isScanning && (
                  <button 
                    onClick={stopScanner}
                    className="absolute top-4 right-4 z-20 w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
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
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                          : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">
                      {session.partNumber ? <CheckCircle className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Part No</span>
                    <span className="text-xs font-mono truncate max-w-full">
                      {session.partNumber || "Pending..."}
                    </span>
                  </button>

                  <button
                    onClick={() => startScanner(ScanTarget.UNIQUE_CODE)}
                    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                      session.uniqueCode 
                        ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400' 
                        : activeTarget === ScanTarget.UNIQUE_CODE && isScanning
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                          : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center mb-2">
                      {session.uniqueCode ? <CheckCircle className="w-5 h-5" /> : <Hash className="w-5 h-5" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest mb-1">Serial</span>
                    <span className="text-xs font-mono truncate max-w-full">
                      {session.uniqueCode || "Pending..."}
                    </span>
                  </button>
                </div>

                <button
                  onClick={handleSave}
                  disabled={!session.partNumber || !session.uniqueCode || isAnalyzing}
                  className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 rounded-2xl font-bold text-white shadow-xl shadow-blue-900/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Complete Scan Pair
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 text-slate-400">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-slate-300">Auto-sync active</p>
                  <p className="opacity-60">Scans are verified and stored instantly.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                Scan Records
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
                <p className="text-sm">Loading records...</p>
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500 border border-dashed border-slate-800 rounded-3xl bg-slate-900/30">
                <Scan className="w-12 h-12 opacity-10" />
                <p className="text-sm">No scans recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {records.map((record) => (
                  <div key={record.id} className="group bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-all shadow-lg shadow-black/20">
                    <div className="flex items-start justify-between mb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-tighter text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">Part</span>
                          <span className="font-mono text-sm font-bold">{record.partNumber}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-tighter text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">Serial</span>
                          <span className="font-mono text-xs text-slate-300">{record.uniqueCode}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDelete(record.id)}
                        className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {record.analysis && (
                      <div className="text-xs text-slate-400 bg-black/20 rounded-xl p-3 border border-slate-800/50 mb-3 leading-relaxed italic">
                        "{record.analysis}"
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                      <span>{new Date(record.timestamp).toLocaleString()}</span>
                      <div className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Verified</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      
      {currentView === 'scan' && !isScanning && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-max px-4 py-2 bg-slate-800/80 backdrop-blur-md rounded-full border border-slate-700 flex items-center gap-2 shadow-2xl">
          <ChevronRight className="w-4 h-4 text-blue-400 animate-pulse" />
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Tap a button above to scan</span>
        </div>
      )}
    </div>
  );
};

// Fixed: Added missing default export
export default App;
