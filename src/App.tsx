import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileText, 
  Upload, 
  Download, 
  Loader2, 
  Table as TableIcon, 
  CheckCircle2, 
  AlertCircle,
  X,
  FileSpreadsheet,
  Settings2,
  Eye,
  EyeOff,
  Save,
  ChevronDown,
  ChevronUp,
  Lock,
  User,
  LogOut,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  MessageSquare,
  Send,
  FolderOpen,
  Files
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { GoogleGenAI, Type } from "@google/genai";
import { cn } from './lib/utils';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- Types ---

interface InvoiceItem {
  srNo: string;
  invoiceNumber: string;
  invoiceDate: string;
  materialModel: string;
  descriptionProduct: string;
  hsCode: string;
  qty: number;
  valueAmount: number;
  originCOO: string;
}

interface ExtractionResult {
  items: InvoiceItem[];
  pageCount?: number;
}

interface FileStatus {
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  customInstructions?: string;
  pageCount?: number;
  progress?: number;
}

interface ColumnConfig {
  key: keyof InvoiceItem;
  label: string;
  enabled: boolean;
}

// --- Constants ---

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          srNo: { type: Type.STRING, description: "Serial number or line item number" },
          invoiceNumber: { type: Type.STRING, description: "The invoice number" },
          invoiceDate: { type: Type.STRING, description: "The date of the invoice" },
          materialModel: { type: Type.STRING, description: "Material or Model number / Code" },
          descriptionProduct: { type: Type.STRING, description: "Description of the product" },
          hsCode: { type: Type.STRING, description: "HS Code or Tariff Code" },
          qty: { type: Type.NUMBER, description: "Quantity" },
          valueAmount: { type: Type.NUMBER, description: "Value or Amount for this item" },
          originCOO: { type: Type.STRING, description: "Country of Origin (COO)" },
        },
        required: ["invoiceNumber", "invoiceDate", "descriptionProduct", "qty", "valueAmount"],
      },
    },
    pageCount: { type: Type.INTEGER, description: "Total number of pages processed in this document" },
  },
  required: ["items"],
};

// --- Components ---

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<{ name: string; role: 'admin' | 'user' } | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);

  const [files, setFiles] = useState<FileStatus[]>([]);
  const [data, setData] = useState<InvoiceItem[]>([]);
  const [history, setHistory] = useState<{ stack: InvoiceItem[][], index: number }>({ stack: [], index: -1 });
  const [isInternalUpdate, setIsInternalUpdate] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [editingFileIndex, setEditingFileIndex] = useState<number | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [isInstructionsSaved, setIsInstructionsSaved] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [columns, setColumns] = useState<ColumnConfig[]>([
    { key: 'srNo', label: 'Sr. No.', enabled: true },
    { key: 'invoiceNumber', label: 'Invoice Number', enabled: true },
    { key: 'invoiceDate', label: 'Invoice Date', enabled: true },
    { key: 'materialModel', label: 'Material/Code', enabled: true },
    { key: 'descriptionProduct', label: 'Product/Description', enabled: true },
    { key: 'hsCode', label: 'Tariffcode/HS Code', enabled: true },
    { key: 'qty', label: 'Qty', enabled: true },
    { key: 'valueAmount', label: 'Amount', enabled: true },
    { key: 'originCOO', label: 'COO/Origin', enabled: true },
  ]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 200;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  useEffect(() => {
    console.log("App state - LoggedIn:", isLoggedIn, "User:", user?.name);
  }, [isLoggedIn, user]);

  useEffect(() => {
    if (isInternalUpdate) {
      setIsInternalUpdate(false);
      return;
    }
    
    const timer = setTimeout(() => {
      if (data.length > 0 || history.stack.length > 0) {
        setHistory(prev => {
          const newStack = prev.stack.slice(0, prev.index + 1);
          const currentDataStr = JSON.stringify(data);
          if (newStack.length > 0 && JSON.stringify(newStack[newStack.length - 1]) === currentDataStr) {
            return prev;
          }
          newStack.push(JSON.parse(currentDataStr));
          if (newStack.length > 50) newStack.shift();
          return { stack: newStack, index: newStack.length - 1 };
        });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [data]);

  const undo = () => {
    if (history.index > 0) {
      setIsInternalUpdate(true);
      const prevIndex = history.index - 1;
      setHistory(prev => ({ ...prev, index: prevIndex }));
      setData(JSON.parse(JSON.stringify(history.stack[prevIndex])));
    }
  };

  const redo = () => {
    if (history.index < history.stack.length - 1) {
      setIsInternalUpdate(true);
      const nextIndex = history.index + 1;
      setHistory(prev => ({ ...prev, index: nextIndex }));
      setData(JSON.parse(JSON.stringify(history.stack[nextIndex])));
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, isProcessing]);

  const processedCount = files.filter(f => f.status === 'completed' || f.status === 'error').length;
  const totalPagesProcessed = files.reduce((acc, f) => acc + (f.pageCount || 0), 0);
  const processingCount = files.filter(f => f.status === 'processing').length;
  const totalInQueue = files.length;
  
  // Calculate progress: completed files + 50% of the currently processing file
  const progressPercentage = totalInQueue > 0 
    ? Math.min(((processedCount + (processingCount * 0.5)) / totalInQueue) * 100, 99) 
    : 0;
    
  // If all are done, show 100%
  const finalProgress = (processedCount === totalInQueue && totalInQueue > 0) ? 100 : progressPercentage;
  
  const currentFile = files.find(f => f.status === 'processing');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const username = loginForm.username.trim();
    if (!username) {
      setLoginError("Please enter your name");
      return;
    }

    if (username.toLowerCase() === 'admin') {
      if (loginForm.password === 'BV@@mumbai@@786') {
        setUser({ name: 'Admin', role: 'admin' });
        setIsLoggedIn(true);
      } else {
        setLoginError("Invalid admin password");
      }
    } else {
      setUser({ name: username, role: 'user' });
      setIsLoggedIn(true);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUser(null);
    setLoginForm({ username: '', password: '' });
    setFiles([]);
    setData([]);
  };

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setIsSubmittingFeedback(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setIsSubmittingFeedback(false);
    setFeedbackSuccess(true);
    setFeedbackText('');
    
    setTimeout(() => {
      setFeedbackSuccess(false);
      setShowFeedbackModal(false);
    }, 2000);
  };

  const onDrop = useCallback(async (acceptedFiles: File[], _fileRejections: any, event: any) => {
    let allFiles: File[] = [];

    // Check if the event has items for folder traversal (drag and drop)
    if (event && event.dataTransfer && event.dataTransfer.items) {
      const items = Array.from(event.dataTransfer.items) as DataTransferItem[];
      
      const traverseEntry = async (entry: any): Promise<File[]> => {
        if (entry.isFile) {
          return new Promise((resolve) => entry.file(resolve));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readAllEntries = async (reader: any): Promise<any[]> => {
            const entries: any[] = [];
            const read = async () => {
              const results = await new Promise<any[]>((resolve) => reader.readEntries(resolve));
              if (results.length > 0) {
                entries.push(...results);
                await read();
              }
            };
            await read();
            return entries;
          };
          
          const entries = await readAllEntries(reader);
          const files = await Promise.all(entries.map(traverseEntry));
          return files.flat();
        }
        return [];
      };

      const entries = items.map(item => item.webkitGetAsEntry()).filter(Boolean);
      const filesFromEntries = await Promise.all(entries.map(traverseEntry));
      allFiles = filesFromEntries.flat();
    } else {
      // Fallback to acceptedFiles for click-to-upload
      allFiles = acceptedFiles;
    }

    const newFiles = await Promise.all(allFiles
      .filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'))
      .map(async f => {
        let pageCount = 1;
        if (f.type === 'application/pdf') {
          try {
            const arrayBuffer = await f.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            pageCount = pdf.numPages;
          } catch (e) {
            console.error("Error counting PDF pages:", e);
          }
        }
        return { file: f, status: 'pending' as const, pageCount };
      }));
    
    if (newFiles.length === 0 && allFiles.length > 0) {
      setError("No supported files (PDF, JPG, PNG) found in the selection.");
      return;
    }

    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: onDrop as any,
    accept: { 
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    multiple: true,
    onDragEnter: undefined,
    onDragOver: undefined,
    onDragLeave: undefined
  });

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4 font-sans relative overflow-hidden">
        {/* 3D Background Elements for Login */}
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-400/10 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-red-400/10 rounded-full blur-[120px] animate-float-delayed" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/20 w-full max-w-md relative z-10 three-d-shadow"
        >
          <div className="flex flex-col items-center mb-10">
            <motion.div 
              whileHover={{ rotate: 10, scale: 1.1 }}
              className="bg-blue-600 p-5 rounded-3xl mb-5 shadow-2xl shadow-blue-200"
            >
              <FileSpreadsheet className="w-10 h-10 text-white" />
            </motion.div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Invoice Pro</h1>
            <p className="text-gray-500 text-sm font-bold mt-2 uppercase tracking-widest">3D Extraction Engine</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 ml-1">User Identity</label>
              <div className="relative">
                <User className="w-5 h-5 text-blue-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full bg-gray-50/50 border-2 border-gray-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-sm font-bold"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            {loginForm.username === 'admin' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 ml-1">Secure Access</label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-red-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full bg-gray-50/50 border-2 border-gray-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-red-500 focus:bg-white transition-all text-sm font-bold"
                    placeholder="••••••••"
                  />
                </div>
              </motion.div>
            )}

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-red-50 text-red-600 text-xs p-4 rounded-2xl border border-red-100 flex items-center gap-3 font-bold"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {loginError}
              </motion.div>
            )}

            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-3 text-sm uppercase tracking-widest three-d-button"
            >
              Get Started
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </form>

          <div className="mt-10 pt-8 border-t border-gray-100 flex flex-col items-center gap-4">
            <div className="flex gap-3">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-200" />
              <div className="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-200" />
              <div className="w-3 h-3 rounded-full bg-yellow-400 shadow-lg shadow-yellow-200" />
            </div>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">By Dinesh JAISWAL</p>
          </div>
        </motion.div>
      </div>
    );
  }

  const retryFile = (index: number) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'pending', error: undefined } : f));
  };

  const reprocessFile = (index: number) => {
    // When reprocessing, we keep the file but set it back to pending
    // We don't clear all data, but the next extraction will append new items
    // (User might want to clear data first, but this allows selective re-processing)
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'pending', error: undefined } : f));
  };

  const handleSaveInstructions = () => {
    setIsInstructionsSaved(true);
    setTimeout(() => setIsInstructionsSaved(false), 2000);
  };

  const updateFileInstructions = (index: number, instructions: string) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, customInstructions: instructions } : f));
  };

  // Helper to compress/resize images for faster processing
  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1600;
          const MAX_HEIGHT = 1600;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Use JPEG with 0.8 quality for good balance of size and clarity
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(dataUrl.split(',')[1]);
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const processFiles = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsProcessing(true);
    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey });
      
      // Concurrency limit: Process 3 files at a time to stay within rate limits while being fast
      const CONCURRENCY_LIMIT = 3;
      const queue = [...files.map((f, i) => ({ file: f, index: i }))].filter(item => item.file.status === 'pending');
      
      const processQueue = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          
          const { file, index: i } = item;

          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing', progress: 0 } : f));

          const progressInterval = setInterval(() => {
            setFiles(prev => prev.map((f, idx) => {
              if (idx === i && f.status === 'processing' && (f.progress || 0) < 92) {
                return { ...f, progress: (f.progress || 0) + Math.random() * 12 };
              }
              return f;
            }));
          }, 500);

          try {
            let base64Data: string;
            if (file.file.type.startsWith('image/')) {
              // Compress images for faster upload/processing
              base64Data = await compressImage(file.file);
            } else {
              // For PDFs, just read as base64
              base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file.file);
              });
            }
            
            const fileInstructions = file.customInstructions || customInstructions;
            const promptText = `Extract invoice data: srNo, invoiceNumber, invoiceDate, materialModel, descriptionProduct, hsCode, qty, valueAmount, originCOO.
            Also count total pages as "pageCount".
            Return JSON: { "items": [...], "pageCount": number }. ${fileInstructions ? `Instructions: ${fileInstructions}` : ""}`;
            
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: [{
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: file.file.type.startsWith('image/') ? 'image/jpeg' : file.file.type, data: base64Data } }
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: EXTRACTION_SCHEMA,
              }
            });

            if (!response.text) throw new Error("EMPTY_RESPONSE");

            const cleanJson = response.text.replace(/```json|```/g, '').trim();
            const result = JSON.parse(cleanJson) as ExtractionResult;
            
            clearInterval(progressInterval);
            if (result.items && result.items.length > 0) {
              setData(prev => [...prev, ...result.items]);
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'completed', pageCount: result.pageCount || f.pageCount, progress: 100 } : f));
            } else {
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: "No items found", progress: 0 } : f));
            }
          } catch (err: any) {
            clearInterval(progressInterval);
            console.error(`[Extraction Error] ${file.file.name}:`, err);
            let errorMessage = "Extraction failed";
            if (err.message === "EMPTY_RESPONSE") errorMessage = "AI returned empty response";
            else if (err.message?.includes("quota") || err.message?.includes("429")) errorMessage = "Rate limit exceeded";
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: errorMessage, progress: 0 } : f));
          }
        }
      };

      // Start concurrent workers
      const workers = Array(Math.min(CONCURRENCY_LIMIT, queue.length))
        .fill(null)
        .map(() => processQueue());
        
      await Promise.all(workers);
    } catch (globalErr: any) {
      console.error(`[Global Extraction Error]:`, {
        message: globalErr.message || globalErr,
        stack: globalErr.stack,
        timestamp: new Date().toISOString()
      });
      if (globalErr.message === "API_KEY_MISSING") {
        setError("Gemini API Key is missing. Please check your environment configuration.");
      } else {
        setError("A critical error occurred during processing.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCellEdit = (rowIndex: number, key: keyof InvoiceItem, value: string | number) => {
    setData(prev => prev.map((row, idx) => {
      if (idx === rowIndex) {
        // Basic type conversion for numeric fields
        const finalValue = (key === 'qty' || key === 'valueAmount') ? Number(value) : value;
        return { ...row, [key]: finalValue };
      }
      return row;
    }));
  };

  const toggleColumn = (key: keyof InvoiceItem) => {
    setColumns(prev => prev.map(col => 
      col.key === key ? { ...col, enabled: !col.enabled } : col
    ));
  };

  const updateColumnLabel = (key: keyof InvoiceItem, label: string) => {
    setColumns(prev => prev.map(col => 
      col.key === key ? { ...col, label } : col
    ));
  };

  const exportToExcel = () => {
    if (data.length === 0) return;
    
    // Filter data based on enabled columns and map to custom labels
    const exportData = data.map(item => {
      const row: any = {};
      columns.forEach(col => {
        if (col.enabled) {
          row[col.label] = item[col.key];
        }
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Data");
    XLSX.writeFile(workbook, `Invoices_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToCSV = () => {
    if (data.length === 0) return;
    
    // Export ALL columns regardless of enabled state
    const exportData = data.map(item => {
      const row: any = {};
      columns.forEach(col => {
        row[col.label] = item[col.key];
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Invoices_Full_Export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setFiles([]);
    setData([]);
    setError(null);
    setCurrentPage(1);
    setHistory({ stack: [], index: -1 });
  };

  const totalPages = Math.ceil(data.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedData = data.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100 relative overflow-hidden">
      {/* 3D Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-400/10 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-red-400/10 rounded-full blur-[120px] animate-float-delayed" />
        <div className="absolute top-[30%] right-[10%] w-[30%] h-[30%] bg-yellow-400/10 rounded-full blur-[120px] animate-float-slow" />
        <div className="absolute bottom-[20%] left-[20%] w-[25%] h-[25%] bg-blue-300/10 rounded-full blur-[100px] animate-float" />
        
        {/* Floating 3D-like shapes */}
        <motion.div 
          animate={{ rotate: 360, y: [0, 20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-20 left-[10%] w-16 h-16 border-4 border-blue-500/20 rounded-xl shadow-[10px_10px_20px_rgba(0,0,0,0.05)]"
        />
        <motion.div 
          animate={{ y: [0, -50, 0], rotate: [0, 90, 0], x: [0, 20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-40 left-[15%] w-12 h-12 bg-red-500/10 rounded-full shadow-[inset_-5px_-5px_10px_rgba(0,0,0,0.1)]"
        />
        <motion.div 
          animate={{ scale: [1, 1.3, 1], rotate: [0, -90, 0], x: [0, -30, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 right-[5%] w-20 h-20 bg-yellow-500/10 rotate-45 shadow-[10px_10px_30px_rgba(0,0,0,0.05)]"
        />
        <motion.div 
          animate={{ rotate: -360, x: [0, 40, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute top-[15%] right-[25%] w-8 h-8 border-2 border-yellow-500/20 rounded-full"
        />
      </div>

      <div className="relative z-10">
        {/* Feedback Modal */}
      <AnimatePresence>
        {showFeedbackModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSubmittingFeedback && setShowFeedbackModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-md overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-100 p-2 rounded-xl">
                      <MessageSquare className="w-5 h-5 text-indigo-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Send Feedback</h3>
                  </div>
                  <button 
                    onClick={() => setShowFeedbackModal(false)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                {feedbackSuccess ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="py-12 flex flex-col items-center text-center"
                  >
                    <div className="bg-emerald-100 p-4 rounded-full mb-4">
                      <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Thank You!</h4>
                    <p className="text-gray-500 text-sm mt-2">Your feedback has been sent successfully.</p>
                  </motion.div>
                ) : (
                  <form onSubmit={submitFeedback} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1">Your Message</label>
                      <textarea
                        required
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Tell us what you think or report an issue..."
                        className="w-full h-40 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmittingFeedback || !feedbackText.trim()}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"
                    >
                      {isSubmittingFeedback ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Send className="w-5 h-5" />
                      )}
                      {isSubmittingFeedback ? "Sending..." : "Send Feedback"}
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-200">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Gemini Invoice Extractor Pro</h1>
              <p className="text-[10px] text-gray-400 font-bold -mt-1 uppercase tracking-widest">3D Optimized • Yellow Red Blue</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end text-right mr-2">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">
                {getGreeting()}, {user?.name}
              </span>
              <span className="text-[10px] text-gray-400 font-medium">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center text-white font-bold shadow-md">
                {user?.name.charAt(0).toUpperCase()}
              </div>
              <span className="font-bold hidden sm:inline">{user?.name}</span>
              {user?.role === 'admin' && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase shadow-sm">Admin</span>
              )}
            </div>
            <div className="h-6 w-px bg-gray-200"></div>
            <button 
              onClick={() => setShowFeedbackModal(true)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium"
              title="Send Feedback"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden lg:inline">Feedback</span>
            </button>
            <div className="h-6 w-px bg-gray-200"></div>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-red-500 transition-colors font-medium">Clear All</button>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress Indicator */}
        <AnimatePresence>
          {isProcessing && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 overflow-hidden relative"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg">
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Processing Invoices...</h3>
                    <p className="text-sm text-gray-500">
                      {currentFile ? (
                        <>
                          Currently extracting: <span className="font-medium text-blue-600">{currentFile.file.name}</span>
                          {currentFile.pageCount && (
                            <span className="ml-2 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-bold">
                              {currentFile.pageCount} {currentFile.pageCount === 1 ? 'Page' : 'Pages'}
                            </span>
                          )}
                        </>
                      ) : 'Preparing files...'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-blue-600">
                    {processedCount === totalInQueue ? 100 : Math.round(finalProgress)}%
                  </span>
                  <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">
                    {processedCount} of {totalInQueue} Completed
                    {totalPagesProcessed > 0 && ` • ${totalPagesProcessed} Pages Read`}
                  </p>
                </div>
              </div>
              
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${finalProgress}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                  className="h-full bg-blue-600 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.4)] relative overflow-hidden"
                >
                  <motion.div 
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 three-d-shadow">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900">
                <Upload className="w-5 h-5 text-blue-500" />
                Upload Invoices
              </h2>
              
              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-4 mb-4",
                  isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-400 hover:bg-gray-50"
                )}
              >
                <input {...getInputProps()} />
                <div className="bg-blue-100 p-4 rounded-full shadow-inner">
                  <Upload className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-900">Drop PDFs, Images or Folders here</p>
                  <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider font-medium">AI will process scans and blurry photos</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4 mb-6">
                <button 
                  onClick={open}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5 transition-colors uppercase tracking-wider"
                >
                  <Files className="w-3.5 h-3.5" /> Select Files
                </button>
                <div className="w-px h-3 bg-gray-200" />
                <button 
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    (input as any).webkitdirectory = true;
                    input.onchange = (e: any) => {
                      const files = Array.from(e.target.files) as File[];
                      onDrop(files, [], null);
                    };
                    input.click();
                  }}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5 transition-colors uppercase tracking-wider"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Select Folder
                </button>
              </div>

              {files.length > 0 && (
                <div className="space-y-3 mb-6 max-h-60 overflow-auto pr-2">
                  <AnimatePresence>
                    {files.map((f, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm"
                      >
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3 overflow-hidden">
                            {f.status === 'processing' ? (
                              <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
                            ) : f.status === 'completed' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                            ) : f.status === 'error' ? (
                              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                            <div className="truncate flex flex-col">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold truncate text-gray-700">{f.file.name}</p>
                                {f.pageCount && (
                                  <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-black whitespace-nowrap">
                                    {f.pageCount} {f.pageCount === 1 ? 'Page' : 'Pages'}
                                  </span>
                                )}
                              </div>
                              {f.status === 'processing' && (
                                <div className="w-full h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${f.progress || 0}%` }}
                                    className="h-full bg-blue-500 rounded-full"
                                  />
                                </div>
                              )}
                                {f.error && (
                                  <div className="flex flex-col gap-1.5 mt-1.5">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-md border border-red-100 flex items-center gap-1">
                                        <AlertCircle className="w-2.5 h-2.5" />
                                        {f.error}
                                      </span>
                                      {!isProcessing && (
                                        <button 
                                          onClick={() => retryFile(idx)}
                                          className="text-[10px] text-blue-600 font-bold hover:text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 flex items-center gap-1 transition-colors shadow-sm"
                                        >
                                          <RefreshCw className="w-2.5 h-2.5" />
                                          Continue
                                        </button>
                                      )}
                                    </div>
                                    {(f.error.includes("AI returned") || f.error.includes("Invalid API Key")) && (
                                      <a 
                                        href="https://ai.google.dev/gemini-api/docs/troubleshooting" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-[9px] text-blue-500 hover:text-blue-700 underline flex items-center gap-1"
                                      >
                                        View Troubleshooting Guide
                                      </a>
                                    )}
                                  </div>
                                )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => setEditingFileIndex(editingFileIndex === idx ? null : idx)}
                              className={cn(
                                "p-1 rounded-full transition-colors",
                                f.customInstructions ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:bg-gray-200"
                              )}
                              title="Edit file instructions"
                            >
                              <Settings2 className="w-3 h-3" />
                            </button>
                            {f.status === 'completed' && !isProcessing && (
                              <button 
                                onClick={() => reprocessFile(idx)}
                                className="p-1 hover:bg-indigo-100 rounded-full text-indigo-500 transition-colors"
                                title="Reprocess with new instructions"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            )}
                            {f.status === 'error' && !isProcessing && (
                              <button 
                                onClick={() => retryFile(idx)}
                                className="p-1 hover:bg-red-100 rounded-full text-red-500 transition-colors"
                                title="Retry"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            )}
                            {!isProcessing && (
                              <button onClick={() => removeFile(idx)} className="p-1 hover:bg-gray-200 rounded-full">
                                <X className="w-3 h-3 text-gray-400" />
                              </button>
                            )}
                          </div>
                        </div>
                        <AnimatePresence>
                          {editingFileIndex === idx && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="px-3 pb-3 border-t border-gray-200 bg-white"
                            >
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 mt-2">File Instructions</label>
                              <textarea
                                value={f.customInstructions || ''}
                                onChange={(e) => updateFileInstructions(idx, e.target.value)}
                                placeholder="Specific instructions for this file..."
                                className="w-full h-20 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={processFiles}
                  disabled={isProcessing || files.filter(f => f.status === 'pending').length === 0}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-200 three-d-button"
                >
                  {isProcessing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <TableIcon className="w-5 h-5" />
                  )}
                  {isProcessing ? "Processing..." : "Extract"}
                </button>
                
                <button
                  onClick={reset}
                  disabled={isProcessing || files.length === 0}
                  className="bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-600 font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <X className="w-5 h-5" />
                  Clear All
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </section>

            <section className="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-gray-100 three-d-shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-blue-500" />
                  AI Instructions
                </h2>
                <button 
                  onClick={handleSaveInstructions}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-lg font-black transition-all flex items-center gap-1.5",
                    isInstructionsSaved 
                      ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                      : "bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100"
                  )}
                >
                  {isInstructionsSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {isInstructionsSaved ? "Instructions Saved" : "Save Settings"}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-3">
                Add specific comments or rules for the AI (e.g., "Ignore tax rows", "Format dates as DD/MM/YYYY").
              </p>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Type your instructions for the AI here..."
                className="w-full h-32 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none mb-4 font-medium"
              />
              
              <button
                onClick={processFiles}
                disabled={isProcessing || files.filter(f => f.status === 'pending').length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-blue-100 three-d-button"
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
                {isProcessing ? "Processing..." : "Generate Extraction"}
              </button>
            </section>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {/* Column Mapping Settings */}
            <AnimatePresence>
              {showColumnSettings && (
                <motion.section 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden three-d-shadow"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-blue-500" />
                      Column Mapping & Visibility
                    </h3>
                    <button onClick={() => setShowColumnSettings(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {columns.map((col) => (
                      <div key={col.key} className="p-3 bg-white rounded-xl border border-gray-100 space-y-2 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">{col.key}</span>
                          <button 
                            onClick={() => toggleColumn(col.key)}
                            className={cn(
                              "p-1 rounded-md transition-colors",
                              col.enabled ? "text-blue-600 bg-blue-50" : "text-gray-400 bg-gray-100"
                            )}
                          >
                            {col.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          </button>
                        </div>
                        <input 
                          type="text"
                          value={col.label}
                          onChange={(e) => updateColumnLabel(col.key, e.target.value)}
                          className="w-full text-xs font-bold bg-gray-50 border border-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="Column Label"
                        />
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[500px] flex flex-col three-d-shadow">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white/50 sticky top-0 z-10">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Consolidated Data</h2>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    {data.length} items extracted 
                    {totalPagesProcessed > 0 && ` • ${totalPagesProcessed} Pages Read`}
                    • Excel-Style Editing Active
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1 mr-2 shadow-sm">
                    <button
                      onClick={undo}
                      disabled={history.index <= 0 || isProcessing}
                      className="p-1.5 rounded-md hover:bg-gray-50 disabled:opacity-30 transition-all text-blue-600"
                      title="Undo (Ctrl+Z)"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={redo}
                      disabled={history.index >= history.stack.length - 1 || isProcessing}
                      className="p-1.5 rounded-md hover:bg-gray-50 disabled:opacity-30 transition-all text-blue-600"
                      title="Redo (Ctrl+Y)"
                    >
                      <Redo2 className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => setShowColumnSettings(!showColumnSettings)}
                    className={cn(
                      "p-2 rounded-lg transition-all border shadow-sm",
                      showColumnSettings ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                    )}
                    title="Column Settings"
                  >
                    <Settings2 className="w-5 h-5" />
                  </button>
                  {data.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportToCSV}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-blue-100 three-d-button"
                        title="Export all data columns to CSV"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        CSV
                      </button>
                      <button
                        onClick={exportToExcel}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-100 three-d-button"
                        title="Export visible columns to Excel"
                      >
                        <Download className="w-4 h-4" />
                        Excel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {data.length > 0 ? (
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className="bg-gray-50/80 sticky top-0 z-10">
                      <tr>
                        {columns.filter(c => c.enabled).map(col => (
                          <th key={col.key} className="px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-200 truncate">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paginatedData.map((item, index) => {
                        const rowIndex = startIndex + index;
                        return (
                          <tr key={rowIndex} className="group hover:bg-blue-50/30 transition-colors">
                            {columns.filter(c => c.enabled).map(col => (
                              <td key={col.key} className="p-0 border-r border-gray-50 last:border-r-0 relative">
                                <input 
                                  type={typeof item[col.key] === 'number' ? 'number' : 'text'}
                                  value={item[col.key]}
                                  onChange={(e) => handleCellEdit(rowIndex, col.key, e.target.value)}
                                  className="w-full h-full bg-transparent border-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white px-4 py-4 text-sm text-gray-700 font-medium transition-all outline-none"
                                />
                                <div className="absolute inset-0 pointer-events-none border-blue-500/0 group-hover:border-blue-500/10 border transition-all" />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 text-gray-400">
                    <div className="bg-gray-50 p-6 rounded-full mb-4">
                      <TableIcon className="w-12 h-12 opacity-20" />
                    </div>
                    <p className="max-w-xs">Upload invoices and click "Start Extraction" to generate your consolidated spreadsheet.</p>
                  </div>
                )}
              </div>

              {data.length > rowsPerPage && (
                <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                  <div className="text-xs text-gray-500 font-medium">
                    Showing <span className="text-gray-900">{startIndex + 1}</span> to <span className="text-gray-900">{Math.min(startIndex + rowsPerPage, data.length)}</span> of <span className="text-gray-900">{data.length}</span> items
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="text-xs font-bold text-gray-900 px-2">
                      Page {currentPage} of {totalPages}
                    </div>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-gray-200 mt-8">
        <div className="flex flex-col items-center justify-center text-gray-400 text-xs gap-1">
          <p>© {new Date().getFullYear()} DJ Gamini PDF Reader</p>
          <p className="font-medium">Developed with ❤️ by Dinesh JAISWAL</p>
        </div>
      </footer>
      </div>
    </div>
  );
}
