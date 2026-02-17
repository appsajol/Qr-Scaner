
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
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {
        console.warn("Error stopping scanner:", e);
      }
      setIsScanning(false);
    }
  }, []);

  const startScanner = useCallback(async (target: ScanTarget) => {
    await stopScanner();
    setActiveTarget(target);
    setError(null);
    setIsScanning(true);
    
    // Slight delay to ensure DOM element is ready
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;
        
        // Optimizing for small QR codes:
        // 1. Higher FPS (30 instead of 15) for smoother detection.
        // 2. High resolution constraints (1280x720 ideal) to capture more detail in small codes.
        // 3. Experimental BarcodeDetector API if available.
        const config = { 
          fps: 30, 
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.floor(minEdge * 0.7);
            return { width: boxSize, height: boxSize };
          },
          aspectRatio: 1.0,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        };
        
        await scanner.start(
          { 
            facingMode: "environment",
            // Requesting high resolution helps with small codes
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 }
          },
          config,
          (decodedText) => {
            const cleaned = decodedText.trim();
            setSession(prev => ({
              ...prev,
              [target]: cleaned
            }));
            stopScanner();
          },
          () => {} // Ignored for performance
        );
      } catch (err) {
        console.error("Scanner Error:", err);
        setError("ক্যামেরা এক্সেস করা যায়নি। ক্যামেরা অনুমতি চেক করুন।");
        setIsScanning(false);
      }
    }, 150);
  }, [stopScanner]);

  const generateId = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
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
        .select('id, part_number')
        .eq('unique_code', session.uniqueCode)
        .maybeSingle();

      if (existing) {
        setError(`ডুপ্লিকেট কোড: ইতিপূর্বে ব্যবহৃত হয়েছে।`);
        setIsAnalyzing(false);
        return;
      }

      const analysis = await analyzeScanPair(session.partNumber, session.uniqueCode);
      const newRecordId = generateId();
      const timestamp = new Date().toISOString();

      const { error: insertError } = await supabase
        .from('scanned_records')
        .insert([{
          id: newRecordId,
          part_number: session.partNumber,
          unique_code: session.uniqueCode,
          timestamp: timestamp,
          analysis: analysis || "Verified"
        }]);

      if (insertError) {
        if (insertError.code === '23505') {
          setError(`ডুপ্লিকেট কোড: ডাটাবেসে রয়েছে।`);
          return;
        }
        throw insertError;
      }

      const newLocalRecord: ScannedRecord = {
        id: newRecordId,
        partNumber: session.partNumber,
        uniqueCode: session.uniqueCode,
        timestamp: timestamp,
        status: 'synced',
        analysis: analysis || "Verified"
      };

      setRecords(prev => [newLocalRecord, ...prev]);
      setSession({ partNumber: null, uniqueCode: null });
      setActiveTarget(ScanTarget.PART_NUMBER);
      setSuccess("সফলভাবে ক্লাউডে সেভ করা হয়েছে!");
      
    } catch (err) {
      setError("ডেটা সেভ করতে সমস্যা হয়েছে।");
      console.error("Save failure:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResetSession = () => {
    setSession({ partNumber: null, uniqueCode: null });
    setActiveTarget(ScanTarget.PART_NUMBER);
    stopScanner();
    setError(null);
  };

  const deleteRecord = async (id: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('scanned_records')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setRecords(prev => prev.filter(r => r.id !== id));
      setSuccess("রেকর্ডটি মুছে ফেলা হয়েছে।");
    } catch (err) {
      setError("রেকর্ড মুছতে সমস্যা হয়েছে।");
    }
  };

  const exportToExcel = () => {
    if (records.length === 0) return;
    try {
      const data = records.map(r => ({
        'Date/Time': new Date(r.timestamp).toLocaleString(),
        'Part Number': r.partNumber,
        'Unique Serial': r.uniqueCode,
        'AI Summary': r.analysis
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Records");
      XLSX.writeFile(wb, `XtraPro_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
      setSuccess("এক্সেল ফাইল ডাউনলোড শুরু হয়েছে।");
    } catch (err) {
      setError("এক্সেল ফাইল তৈরি করা যায়নি।");
    }
  };

  return (
    <div className="min-h-screen pb-24 flex flex-col font-sans bg-slate-50">
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 py-3 sticky top-0 z-30 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <Package className="text-white w-4 h-4" />
            </div>
            <h1 className="font-extrabold text-lg tracking-tight text-slate-800">XtraPro</h1>
          </div>
          <div className="flex items-center gap-2">
             <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                <div className={`w-1.5 h-1.5 rounded-full ${records.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  {isLoading ? 'SYNCING' : 'CLOUD'}
                </span>
             </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-4">
        {currentView === 'scan' && (
          <div className="animate-in fade-in duration-300 space-y-6">
            {isScanning && (
              <section className="bg-slate-900 rounded-2xl overflow-hidden shadow-xl relative aspect-square max-w-[320px] mx-auto w-full mb-4 border-2 border-white">
                <div id={SCANNER_ID} className="w-full h-full bg-black"></div>
                <ScannerOverlay activeTarget={activeTarget} isScanning={isScanning} />
                <button onClick={stopScanner} className="absolute top-3 right-3 bg-black/40 hover:bg-black/60 backdrop-blur-md text-white p-1.5 rounded-full z-20">
                  <X className="w-5 h-5" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-[10px] font-bold uppercase tracking-widest bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm z-10 text-center">
                  Hold close for small codes
                </div>
              </section>
            )}

            <section className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4 mb-8">
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2.5">
                  <Scan className="w-5 h-5 text-blue-600" />
                  Scanner Input
                </h2>
                <button onClick={handleResetSession} className="text-slate-400 hover:text-red-500 flex items-center gap-1 text-[10px] font-black tracking-widest uppercase transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Part Number</label>
                  <div className="relative flex items-center group">
                    <div className="absolute left-5 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                      <Hash className="w-5 h-5" />
                    </div>
                    <input 
                      type="text" readOnly placeholder="Scan part..." value={session.partNumber || ''}
                      className={`w-full pl-14 pr-16 py-5 bg-slate-50 border-2 rounded-2xl text-lg font-mono focus:outline-none transition-all ${
                        session.partNumber ? 'border-blue-200 bg-blue-50/20' : 'border-slate-100'
                      }`}
                    />
                    <button onClick={() => startScanner(ScanTarget.PART_NUMBER)} className={`absolute right-3 p-3.5 rounded-xl transition-all ${activeTarget === ScanTarget.PART_NUMBER && isScanning ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-blue-600 border border-slate-100 shadow-sm hover:bg-slate-50'}`}>
                      <Camera className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Unique Serial</label>
                  <div className="relative flex items-center group">
                    <div className="absolute left-5 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                      <ScanLine className="w-5 h-5" />
                    </div>
                    <input 
                      type="text" readOnly placeholder="Scan serial..." value={session.uniqueCode || ''}
                      className={`w-full pl-14 pr-16 py-5 bg-slate-50 border-2 rounded-2xl text-lg font-mono focus:outline-none transition-all ${
                        session.uniqueCode ? 'border-blue-200 bg-blue-50/20' : 'border-slate-100'
                      }`}
                    />
                    <button onClick={() => startScanner(ScanTarget.UNIQUE_CODE)} className={`absolute right-3 p-3.5 rounded-xl transition-all ${activeTarget === ScanTarget.UNIQUE_CODE && isScanning ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-blue-600 border border-slate-100 shadow-sm hover:bg-slate-50'}`}>
                      <Camera className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleSave}
                disabled={!session.partNumber || !session.uniqueCode || isAnalyzing}
                className="w-full mt-10 py-5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-300 text-white font-black text-xl transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-4"
              >
                {isAnalyzing ? <><Loader2 className="w-6 h-6 animate-spin" />Saving...</> : <><CheckCircle2 className="w-7 h-7" />Save Record</>}
              </button>
            </section>
          </div>
        )}

        {currentView === 'history' && (
          <section className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300 pb-12">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Recent Activity</h3>
                <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md">{records.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={fetchRecords} className="p-1.5 text-slate-500 hover:text-blue-600 bg-white border border-slate-200 rounded-lg shadow-sm">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={exportToExcel} disabled={records.length === 0} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm text-[11px] uppercase tracking-wider">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {records.length === 0 && !isLoading ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No Cloud Data</p>
                </div>
              ) : (
                records.map((record, index) => (
                  <div key={record.id} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm hover:border-blue-200 transition-colors group">
                    <div className="flex items-center justify-between gap-3">
                      <div className="shrink-0 w-5 h-5 flex items-center justify-center bg-slate-100 rounded-md">
                        <span className="text-[10px] font-black text-slate-400">{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                           <div className="flex items-center gap-1 min-w-0">
                             <span className="text-[7px] font-black text-slate-400 uppercase tracking-tighter">PT</span>
                             <span className="font-mono text-slate-800 font-bold text-xs truncate bg-slate-50 px-1 py-0.5 rounded border border-slate-100">{record.partNumber}</span>
                           </div>
                           <ChevronRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />
                           <div className="flex items-center gap-1 min-w-0">
                             <span className="text-[7px] font-black text-slate-400 uppercase tracking-tighter">SN</span>
                             <span className="font-mono text-blue-700 font-bold text-xs truncate bg-blue-50 px-1 py-0.5 rounded border border-blue-100/50">{record.uniqueCode}</span>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] text-slate-400 font-medium">
                            {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(record.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                          </span>
                          {record.analysis && (
                            <span className="text-[8px] text-slate-500 font-medium truncate max-w-[120px] border-l border-slate-200 pl-1.5">
                              {record.analysis}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => { if(confirm('Delete record?')) deleteRecord(record.id) }} className="text-slate-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-200 z-50 px-8 pb-6 pt-3 flex items-center justify-around shadow-lg">
        <button onClick={() => setCurrentView('scan')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'scan' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-2 rounded-xl transition-colors ${currentView === 'scan' ? 'bg-blue-50' : ''}`}><Scan className="w-5 h-5" /></div>
          <span className="text-[9px] font-black uppercase tracking-[0.15em]">Scan</span>
        </button>
        <button onClick={() => setCurrentView('history')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'history' ? 'text-blue-600' : 'text-slate-400'}`}>
          <div className={`p-2 rounded-xl transition-colors ${currentView === 'history' ? 'bg-blue-50' : ''}`}><History className="w-5 h-5" /></div>
          <span className="text-[9px] font-black uppercase tracking-[0.15em]">History</span>
        </button>
      </nav>

      <div className="fixed bottom-24 left-4 right-4 md:right-8 md:left-auto md:max-w-sm flex flex-col gap-2 z-50">
        {error && (
          <div className={`w-full ${error.includes('ডুপ্লিকেট') ? 'bg-amber-500' : 'bg-rose-600'} text-white p-3.5 rounded-xl shadow-xl flex items-start gap-3 animate-in slide-in-from-bottom-4 border border-white/10`}>
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0"><p className="text-xs font-bold leading-tight">{error}</p></div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="w-full bg-emerald-600 text-white p-3.5 rounded-xl shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-4 border border-white/10">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-xs font-bold">{success}</p>
            <button onClick={() => setSuccess(null)} className="ml-auto p-1 hover:bg-white/20 rounded-lg"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
