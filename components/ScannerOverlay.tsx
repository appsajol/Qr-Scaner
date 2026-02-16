
import React from 'react';
import { ScanTarget } from '../types';

interface ScannerOverlayProps {
  activeTarget: ScanTarget;
  isScanning: boolean;
}

export const ScannerOverlay: React.FC<ScannerOverlayProps> = ({ activeTarget, isScanning }) => {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      {/* 
        Darkened Backdrop with Central Square Cutout 
        Using clip-path to create a precise symmetric mask for the scan area
      */}
      <div 
        className="absolute inset-0 bg-black/60 z-0" 
        style={{
          clipPath: 'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%, calc(50% - 130px) calc(50% - 130px), calc(50% + 130px) calc(50% - 130px), calc(50% + 130px) calc(50% + 130px), calc(50% - 130px) calc(50% + 130px), calc(50% - 130px) calc(50% - 130px))'
        }}
      />

      {/* Symmetric Blue Scan Box */}
      <div className="relative w-[260px] h-[260px] flex items-center justify-center z-10">
        {/* Main Blue Border */}
        <div className="absolute inset-0 border-2 border-blue-500/30 rounded-2xl shadow-[0_0_15px_rgba(59,130,246,0.2)]" />
        
        {/* Reinforced Corner Accents for better visibility */}
        <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-blue-500 rounded-tl-xl shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-blue-500 rounded-tr-xl shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-blue-500 rounded-bl-xl shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-blue-500 rounded-br-xl shadow-[0_0_10px_rgba(59,130,246,0.6)]" />

        {/* Dynamic Scanning Line */}
        {isScanning && (
          <div className="absolute left-2 right-2 h-0.5 bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,1)] animate-[scan_2.5s_ease-in-out_infinite]" />
        )}

        {/* Subtle Inner Glow */}
        {isScanning && (
          <div className="absolute inset-0 bg-blue-500/5 animate-pulse rounded-xl" />
        )}

        {/* Minimal Contextual Label */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2">
           <span className="bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-md shadow-lg border border-blue-400/20">
             {activeTarget === ScanTarget.PART_NUMBER ? 'PART' : 'SERIAL'}
           </span>
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 10%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
      `}</style>
    </div>
  );
};
