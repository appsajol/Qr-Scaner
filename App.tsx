
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
  AlertTriangle,
  CheckCircle,
  Database,
  Scan
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScannedRecord, ScanSession, ScanTarget } from './types';
import { ScannerOverlay } from './components/ScannerOverlay';
import { analyzeScanPair } from './services/geminiService';
import { supabase } from './services/supabaseClient';

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

  // Fetch initial data from Supabase
  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('scanned_records')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) throw error;
      
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

  // Success toast auto-hide
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
    
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;
        
        const config = { 
          fps: 15, 
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0
        };
        
        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            const cleaned = decodedText.trim();
            setSession(prev => ({
              ...prev,
              [target]: cleaned
            }));
            stopScanner();
          },
          () => {} 
        );
      } catch (err) {
        setError("ক্যামেরা এক্সেস করা যায়নি।");
        setIsScanning(false);
      }
    }, 100);
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
    <div className="min-h-screen pb-24 md:pb-8 flex flex-col font-sans bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg shadow-blue-200 shadow-lg">
              <Package className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-800">XtraPro Scanner</h1>
          </div>
          
          <div className="flex items-center gap-2">
             <div className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                <div className={`w-2 h-2 rounded-full ${records.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {isLoading ? 'Syncing...' : 'Connected'}
                </span>
             </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-4 space-y-6">
        
        {/* VIEW 1: SCANNING */}
        {currentView === 'scan' && (
          <div className="animate-in fade-in duration-500">
            {/* Active Scan Area */}
            {isScanning && (
              <section className="bg-slate-900 rounded-3xl overflow-hidden shadow-2xl relative aspect-square max-w-sm mx-auto w-full mb-6 animate-in zoom-in-95 duration-300 border-4 border-white">
                <div id={SCANNER_ID} className="w-full h-full bg-black"></div>
                <ScannerOverlay activeTarget={activeTarget} isScanning={isScanning} />
                <button 
                  onClick={stopScanner}
                  className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white p-2 rounded-full transition-colors z-20"
                >
                  <X className="w-6 h-6" />
                </button>
              </section>
            )}

            {/* Pairing Interface */}
            <section className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2.5">
                  <Scan className="w-5 h-5 text-blue-600" />
                  Scanner Feed
                </h2>
                <button 
                  onClick={handleResetSession}
                  className="text-slate-400 hover:text-red-500 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
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
                    <button onClick={() => startScanner(ScanTarget.PART_NUMBER)} className={`absolute right-3 p-3.5 rounded-xl transition-all ${activeTarget === ScanTarget.PART_NUMBER && isScanning ? 'bg-blue-600 text-white shadow-lg scale-110' : 'bg-white text-blue-600 hover:bg-blue-50 border border-blue-100 shadow-sm'}`}>
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
                    <button onClick={() => startScanner(ScanTarget.UNIQUE_CODE)} className={`absolute right-3 p-3.5 rounded-xl transition-all ${activeTarget === ScanTarget.UNIQUE_CODE && isScanning ? 'bg-blue-600 text-white shadow-lg scale-110' : 'bg-white text-blue-600 hover:bg-blue-50 border border-blue-100 shadow-sm'}`}>
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

        {/* VIEW 2: HISTORY */}
        {currentView === 'history' && (
          <section className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500 pb-12">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Database className="w-5 h-5 text-slate-500" />
                Cloud History
              </h3>
              <div className="flex items-center gap-2">
                <button 
                  onClick={fetchRecords}
                  className="p-2.5 text-slate-500 hover:text-blue-600 transition-colors bg-white border border-slate-200 rounded-xl shadow-sm"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button 
                  onClick={exportToExcel}
                  disabled={records.length === 0}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-md active:scale-95 text-sm"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Export Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {records.length === 0 && !isLoading ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center">
                  <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Package className="w-8 h-8 text-slate-300" /></div>
                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No Cloud Data</p>
                </div>
              ) : (
                records.map((record) => (
                  <div key={record.id} className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm hover:shadow-lg transition-all group relative border-l-4 border-l-blue-500">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                      <div className="space-y-4 flex-1">
                        <div className="flex items-center gap-6 flex-wrap">
                          <div className="flex flex-col">
                             <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Part Code</span>
                             <span className="font-mono text-slate-800 font-bold text-base bg-slate-50 px-2 py-1 rounded-md">{record.partNumber}</span>
                          </div>
                          <div className="flex flex-col">
                             <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Serial</span>
                             <span className="font-mono text-blue-700 font-bold text-base bg-blue-50 px-2 py-1 rounded-md">{record.uniqueCode}</span>
                          </div>
                          <div className="ml-auto text-right">
                             <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-2 py-1 rounded-md">
                              {new Date(record.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                             </span>
                          </div>
                        </div>
                        {record.analysis && (
                          <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100"><p className="text-slate-600 text-xs leading-relaxed font-medium">{record.analysis}</p></div>
                        )}
                      </div>
                      <button onClick={() => { if(confirm('মুছে ফেলবেন?')) deleteRecord(record.id) }} className="text-slate-300 hover:text-red-500 p-2 transition-colors sm:opacity-0 group-hover:opacity-100 bg-slate-50 rounded-full hover:bg-red-50"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-slate-200 z-50 px-6 pb-6 pt-3 flex items-center justify-around shadow-[0_-10px_30px_rgba(0,0,0,0.03)]">
        <button 
          onClick={() => setCurrentView('scan')}
          className={`flex flex-col items-center gap-1 transition-all ${currentView === 'scan' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <div className={`p-2 rounded-xl ${currentView === 'scan' ? 'bg-blue-50' : ''}`}>
            <Scan className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider">Scan</span>
        </button>

        <button 
          onClick={() => setCurrentView('history')}
          className={`flex flex-col items-center gap-1 transition-all ${currentView === 'history' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <div className={`p-2 rounded-xl ${currentView === 'history' ? 'bg-blue-50' : ''}`}>
            <History className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider">History</span>
        </button>
      </nav>

      {/* Notifications Layer */}
      <div className="fixed bottom-28 left-4 right-4 md:bottom-20 md:right-8 md:left-auto md:max-w-sm flex flex-col gap-3 z-50">
        {error && (
          <div className={`w-full ${error.includes('ডুপ্লিকেট') ? 'bg-amber-500' : 'bg-rose-600'} text-white p-4 rounded-2xl shadow-2xl flex items-start gap-3 animate-in slide-in-from-bottom-6 border border-white/20`}>
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-bold text-sm mb-1 uppercase tracking-wider">Alert</h4>
              <p className="text-sm font-medium opacity-90 leading-tight">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
        )}
        {success && (
          <div className="w-full bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-6 border border-white/20">
            <CheckCircle className="w-6 h-6 flex-shrink-0" />
            <p className="text-sm font-black tracking-wide">{success}</p>
            <button onClick={() => setSuccess(null)} className="ml-auto p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
