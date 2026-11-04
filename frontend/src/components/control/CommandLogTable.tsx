import React, { useState, useEffect } from 'react';
import { 
  ClipboardList, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Clock, 
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { CommandLogEntry } from '../../types/command';
import { commandService } from '../../services/commandService';

export const CommandLogTable: React.FC = () => {
  const [logs, setLogs] = useState<CommandLogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = commandService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return () => unsubscribe();
  }, []);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <ClipboardList className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Nhật Ký Thực Thi Lệnh (Command Acknowledgment Log)
          </h3>
          <span className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 text-slate-600 rounded-full border border-slate-200">
            {logs.length} bản ghi
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            {isExpanded ? (
              <>
                <span>Thu gọn</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Mở rộng</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* TABLE */}
      {isExpanded && (
        <div className="mt-3 overflow-x-auto">
          {logs.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400">
              Chưa có lệnh nào được gửi trong phiên làm việc này.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Thời gian</th>
                  <th className="py-2.5 px-3">Thiết bị</th>
                  <th className="py-2.5 px-3">Thao tác</th>
                  <th className="py-2.5 px-3">Trạng thái</th>
                  <th className="py-2.5 px-3">Độ trễ</th>
                  <th className="py-2.5 px-3">Phản hồi từ ESP32</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{formatTime(log.timestamp)}</span>
                    </td>
                    <td className="py-2.5 px-3 font-sans font-bold text-slate-800 whitespace-nowrap">
                      {log.deviceName}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-bold ${
                        log.value ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {log.actionText}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {log.status === 'success' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-sans font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Thành công
                        </span>
                      )}
                      {log.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-sans font-medium">
                          <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" /> Đang gửi...
                        </span>
                      )}
                      {log.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-sans font-medium">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" /> Thất bại
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 font-bold whitespace-nowrap">
                      {log.latencyMs !== undefined ? `${log.latencyMs}ms` : '--'}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-600 text-xs">
                      {log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
