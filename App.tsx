
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
  Database
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScannedRecord, ScanSession, ScanTarget } from './types';
import { ScannerOverlay } from './components/ScannerOverlay';
import { analyzeScanPair } from './services/geminiService';
import { supabase } from './services/supabaseClient';

const SCANNER_ID = "qr-reader";

const App: React.FC = () => {
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
      
      // Map database snake_case to frontend camelCase
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
      setError("ডেটা লোড করতে সমস্যা হয়েছে। দয়া করে রিফ্রেশ করুন।");
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
            setSession(prev => ({
              ...prev,
              [target]: decodedText
            }));
            stopScanner();
          },
          () => {} 
        );
      } catch (err) {
        setError("ক্যামেরা এক্সেস করা যায়নি। দয়া করে পারমিশন চেক করুন।");
        setIsScanning(false);
      }
    }, 100);
  }, [stopScanner]);

  const generateId = () => {
    try {
      return crypto.randomUUID();
    } catch (e) {
      return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
      // 1. Server-side Duplicate Check in Supabase
      const { data: existing, error: checkError } = await supabase
        .from('scanned_records')
        .select('id, part_number')
        .eq('unique_code', session.uniqueCode)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        setError(`ডুপ্লিকেট কোড: "${session.uniqueCode}" ইতিপূর্বে পার্ট "${existing.part_number}" এর জন্য সংরক্ষিত হয়েছে।`);
        setIsAnalyzing(false);
        return;
      }

      // 2. AI Analysis
      const analysis = await analyzeScanPair(session.partNumber, session.uniqueCode);
      
      const newRecordId = generateId();
      const timestamp = new Date().toISOString();

      // 3. Insert into Supabase
      const { error: insertError } = await supabase
        .from('scanned_records')
        .insert([{
          id: newRecordId,
          part_number: session.partNumber,
          unique_code: session.uniqueCode,
          timestamp: timestamp,
          analysis: analysis || "Verified"
        }]);

      if (insertError) throw insertError;

      // 4. Update local state
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
      setSuccess("সফলভাবে সুপাবেস-এ সেভ করা হয়েছে!");
    } catch (err) {
      setError("সুপাবেস-এ ডেটা সেভ করতে সমস্যা হয়েছে। ইন্টারনেট কানেকশন চেক করুন।");
      console.error("Save error:", err);
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
      console.error("Delete error:", err);
    }
  };

  const exportToExcel = () => {
    if (records.length === 0) return;
    
    try {
      const data = records.map(r => ({
        'Timestamp': new Date(r.timestamp).toLocaleString(),
        'Part Number': r.partNumber,
        'Unique Serial Code': r.uniqueCode,
        'AI Analysis': r.analysis
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scans");
      XLSX.writeFile(wb, `Scan_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      setSuccess("এক্সেল ফাইল ডাউনলোড শুরু হয়েছে।");
    } catch (err) {
      setError("এক্সেল ফাইল তৈরি করা যায়নি।");
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-8 flex flex-col font-sans bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Package className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-800">ScanPair</h1>
          </div>
          <div className="flex items-center gap-2">
             <button 
              onClick={fetchRecords}
              className="p-2 text-slate-500 hover:text-blue-600 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={exportToExcel}
              disabled={records.length === 0}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-sm active:scale-95"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">Export Excel</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-4 space-y-6">
        
        {/* Active Scan Area */}
        {isScanning && (
          <section className="bg-slate-900 rounded-3xl overflow-hidden shadow-2xl relative aspect-square max-w-sm mx-auto w-full animate-in fade-in zoom-in-95 duration-300 border-4 border-slate-800">
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
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              Cloud Scan Entry
            </h2>
            <button 
              onClick={handleResetSession}
              className="text-slate-400 hover:text-red-500 flex items-center gap-1 text-sm font-medium transition-colors p-1"
            >
              <Trash2 className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="space-y-4">
            {/* Part Number Input */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                Part Number
              </label>
              <div className="relative flex items-center group">
                <div className="absolute left-4 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                  <Hash className="w-5 h-5" />
                </div>
                <input 
                  type="text"
                  readOnly
                  placeholder="Scan part code..."
                  value={session.partNumber || ''}
                  className={`w-full pl-12 pr-14 py-4 bg-slate-50 border-2 rounded-xl text-lg font-mono focus:outline-none transition-all ${
                    session.partNumber ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100 focus:border-blue-500'
                  }`}
                />
                <button 
                  onClick={() => startScanner(ScanTarget.PART_NUMBER)}
                  className={`absolute right-2 p-3 rounded-lg transition-all ${
                    activeTarget === ScanTarget.PART_NUMBER && isScanning 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'bg-white text-blue-600 hover:bg-blue-50 border border-blue-100 shadow-sm'
                  }`}
                >
                  <Camera className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Unique Code Input */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                Unique Serial
              </label>
              <div className="relative flex items-center group">
                <div className="absolute left-4 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                  <ScanLine className="w-5 h-5" />
                </div>
                <input 
                  type="text"
                  readOnly
                  placeholder="Scan serial..."
                  value={session.uniqueCode || ''}
                  className={`w-full pl-12 pr-14 py-4 bg-slate-50 border-2 rounded-xl text-lg font-mono focus:outline-none transition-all ${
                    session.uniqueCode ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100 focus:border-blue-500'
                  }`}
                />
                <button 
                  onClick={() => startScanner(ScanTarget.UNIQUE_CODE)}
                  className={`absolute right-2 p-3 rounded-lg transition-all ${
                    activeTarget === ScanTarget.UNIQUE_CODE && isScanning 
                      ? 'bg-blue-600 text-white shadow-lg' 
                      : 'bg-white text-blue-600 hover:bg-blue-50 border border-blue-100 shadow-sm'
                  }`}
                >
                  <Camera className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <button 
            onClick={handleSave}
            disabled={!session.partNumber || !session.uniqueCode || isAnalyzing}
            className="w-full mt-8 py-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-300 text-white font-bold text-lg transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-3"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Syncing with Cloud...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-6 h-6" />
                Save to Database
              </>
            )}
          </button>
        </section>

        {/* Scan History */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <History className="w-5 h-5 text-slate-500" />
              Cloud History
            </h3>
            <div className="flex items-center gap-4">
               {isLoading && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
               <span className="text-xs text-slate-400 font-medium">{records.length} records</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {records.length === 0 && !isLoading ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center">
                <p className="text-slate-400 text-sm font-medium">ক্লাউড হিস্ট্রি খালি। স্ক্যান শুরু করুন।</p>
              </div>
            ) : (
              records.map((record) => (
                <div 
                  key={record.id} 
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow group relative"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex flex-col">
                           <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Part Number</span>
                           <span className="font-mono text-slate-800 font-bold text-sm">{record.partNumber}</span>
                        </div>
                        <div className="w-px h-6 bg-slate-100 hidden sm:block"></div>
                        <div className="flex flex-col">
                           <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Unique Serial</span>
                           <span className="font-mono text-slate-800 font-bold text-sm">{record.uniqueCode}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 ml-auto font-medium">
                          {new Date(record.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      {record.analysis && (
                        <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                          <p className="text-slate-700 text-xs leading-relaxed font-medium">
                            {record.analysis}
                          </p>
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => { if(confirm('রেকর্ডটি মুছে ফেলবেন?')) deleteRecord(record.id) }}
                      className="text-slate-300 hover:text-red-500 p-2 transition-colors sm:opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {/* Notifications Layer */}
      <div className="fixed bottom-24 left-4 right-4 md:bottom-8 md:right-8 md:left-auto md:max-w-md flex flex-col gap-2 z-50">
        {/* Error/Duplicate Toast */}
        {error && (
          <div className={`w-full ${error.includes('ডুপ্লিকেট') ? 'bg-amber-500' : 'bg-red-600'} text-white p-4 rounded-xl shadow-2xl flex items-start gap-3 animate-in slide-in-from-bottom-4 border border-white/20`}>
            {error.includes('ডুপ্লিকেট') ? <AlertTriangle className="w-6 h-6 flex-shrink-0" /> : <AlertCircle className="w-6 h-6 flex-shrink-0" />}
            <div className="flex-1">
              <h4 className="font-bold text-sm mb-1">সতর্কতা/ত্রুটি</h4>
              <p className="text-sm font-medium opacity-90 leading-tight">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-md transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Success Toast */}
        {success && (
          <div className="w-full bg-emerald-600 text-white p-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-4 border border-white/20">
            <CheckCircle className="w-6 h-6 flex-shrink-0" />
            <p className="text-sm font-bold">{success}</p>
            <button onClick={() => setSuccess(null)} className="ml-auto p-1 hover:bg-white/20 rounded-md">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
