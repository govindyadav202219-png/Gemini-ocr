/**
 * 🚀 Invoice Extractor v0.1.0
 * ---------------------------------------------------------
 * Built with passion for high-precision data extraction.
 * 
 * Features:
 * - Advanced OCR Preprocessing (Integral Image Adaptive Thresholding)
 * - Gemini AI Powered Data Structuring
 * - Real-time Multi-user Presence via WebSockets
 * - Responsive 3D-styled UI with Framer Motion
 * 
 * @author AI Studio Build Agent
 * @license MIT
 */

/**
 * 🚀 Invoice Extractor v0.1.0
 * ---------------------------------------------------------
 * Built with passion for high-precision data extraction.
 * 
 * Features:
 * - Advanced OCR Preprocessing (Integral Image Adaptive Thresholding)
 * - Gemini AI Powered Data Structuring
 * - Real-time Multi-user Presence via WebSockets
 * - Responsive 3D-styled UI with Framer Motion
 * 
 * @author AI Studio Build Agent
 * @license MIT
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  FileJson,
  Settings2,
  Eye,
  EyeOff,
  Zap,
  ZapOff,
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
  Search,
  FolderOpen,
  Files,
  Archive,
  Plus,
  Trash2,
  Key,
  Copy,
  Users,
  GripVertical,
  FileUp,
  Filter,
  Mail,
  Camera,
  MessageCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import toast, { Toaster } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import JSZip from 'jszip';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { GoogleGenAI, Type } from "@google/genai";
import { cn } from './lib/utils';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- Types ---

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

let globalGeminiKey = "";

const fetchGlobalConfig = async () => {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      if (config.geminiApiKey) {
        globalGeminiKey = config.geminiApiKey;
        return true;
      }
    }
  } catch (e) {
    console.error("Failed to fetch global config:", e);
  }
  return false;
};

const checkApiKey = async () => {
  // First check if we already have a global key
  if (globalGeminiKey && globalGeminiKey.length > 10) return true;
  
  // Try to fetch from server if not in AI Studio
  const hasGlobal = await fetchGlobalConfig();
  if (hasGlobal) return true;

  if (typeof window !== 'undefined' && window.aistudio) {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await window.aistudio.openSelectKey();
      return true; // Assume success after opening dialog
    }
  }
  return true;
};

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
  fileId: string;
}

interface ExtractionResult {
  items: InvoiceItem[];
  pageCount?: number;
}

interface FileStatus {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  customInstructions?: string;
  pageCount?: number;
  progress?: number;
  statusText?: string;
  rawText?: string;
  processedDate?: string;
  usePreprocessing: boolean;
  originalPreview?: string;
  preprocessedPreview?: string;
}

interface ColumnConfig {
  key: keyof InvoiceItem;
  label: string;
  enabled: boolean;
}

interface OCRConfig {
  language: string;
  psm: string;
  oem: string;
  advancedPreprocessing: boolean;
  pdfScale: number;
  adaptiveThreshold: boolean;
  thresholdBlockSize: number;
  thresholdC: number;
  despeckle: boolean;
  despeckleRadius: number;
  removeLines: boolean;
  lineRemovalLength: number;
  lineRemovalThickness: number;
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
          valueAmount: { type: Type.NUMBER, description: "Value or Amount for this item. Use 0 if not found (e.g. on Packing Lists)." },
          originCOO: { type: Type.STRING, description: "Country of Origin (COO)" },
        },
        required: ["descriptionProduct", "qty"],
      },
    },
    pageCount: { type: Type.INTEGER, description: "Total number of pages processed in this document" },
  },
  required: ["items"],
};

// --- Helper Functions ---

async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries <= 0) throw err;
    
    let status = err.status || (err.response && err.response.status);
    let errorStr = String(err).toLowerCase();
    
    // Try to parse err.message if it's JSON
    if (err.message && typeof err.message === 'string' && err.message.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) {
          status = status || parsed.error.code;
          if (parsed.error.status) errorStr += " " + parsed.error.status.toLowerCase();
          if (parsed.error.message) errorStr += " " + parsed.error.message.toLowerCase();
        }
      } catch (e) {}
    }

    // Handle the specific error structure reported by the user: {"error":{"message":"","code":500,"status":"Internal Server Error"}}
    if (!status && err.error && typeof err.error === 'object') {
      status = err.error.code || (err.error.status === 'Internal Server Error' ? 500 : undefined);
      if (err.error.status) errorStr += " " + err.error.status.toLowerCase();
      if (err.error.message) errorStr += " " + err.error.message.toLowerCase();
    }
    
    const isRetryable = (status && status >= 500) || status === 429 || 
                        errorStr.includes("500") || errorStr.includes("429") ||
                        errorStr.includes("internal server error") ||
                        errorStr.includes("overloaded") ||
                        errorStr.includes("deadline exceeded") ||
                        errorStr.includes("service unavailable") ||
                        errorStr.includes("socket hang up") ||
                        errorStr.includes("econnreset");

    if (isRetryable) {
      console.warn(`[Retry] Attempt failed with status ${status}. Retrying in ${delay}ms... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retry(fn, retries - 1, delay * 1.5);
    }
    throw err;
  }
}

  // --- Image Preprocessing Pipeline ---
  // We use an Integral Image (Summed-Area Table) for O(1) local mean calculation.
  // This is the secret sauce for lightning-fast adaptive thresholding on high-res scans.
  const preprocessImage = async (canvas: HTMLCanvasElement, config: OCRConfig): Promise<string> => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas.toDataURL('image/png');

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 1. Grayscale
  const grayscale = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i += 4) {
    grayscale[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  // 2. Adaptive Thresholding
  if (config.adaptiveThreshold) {
    const blockSize = config.thresholdBlockSize;
    const C = config.thresholdC;
    const halfBlock = Math.floor(blockSize / 2);
    
    // Create Integral Image (Summed-Area Table)
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += grayscale[y * width + x];
        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const y1 = Math.max(0, y - halfBlock);
        const y2 = Math.min(height, y + halfBlock + 1);
        const x1 = Math.max(0, x - halfBlock);
        const x2 = Math.min(width, x + halfBlock + 1);
        
        const count = (y2 - y1) * (x2 - x1);
        const sum = integral[y2 * (width + 1) + x2] - 
                    integral[y1 * (width + 1) + x2] - 
                    integral[y2 * (width + 1) + x1] + 
                    integral[y1 * (width + 1) + x1];
        
        const threshold = (sum / count) - C;
        const idx = (y * width + x) * 4;
        const v = grayscale[y * width + x] > threshold ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }
  } else {
    // Otsu's Method (Existing)
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < grayscale.length; i++) {
      histogram[grayscale[i]]++;
    }

    let total = grayscale.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 127;

    for (let i = 0; i < 256; i++) {
      wB += histogram[i];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += i * histogram[i];
      let mB = sumB / wB;
      let mF = (sum - sumB) / wF;
      let varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = i;
      }
    }

    for (let i = 0; i < data.length; i += 4) {
      const v = grayscale[i / 4] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  // 3. Despeckle (Median Filter)
  if (config.despeckle) {
    const radius = config.despeckleRadius;
    const tempData = new Uint8ClampedArray(data);
    const neighbors = new Uint8ClampedArray((2 * radius + 1) * (2 * radius + 1));
    
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        let nIdx = 0;
        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            neighbors[nIdx++] = tempData[((y + ky) * width + (x + kx)) * 4];
          }
        }
        neighbors.sort();
        const median = neighbors[Math.floor(neighbors.length / 2)];
        const idx = (y * width + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = median;
      }
    }
  }

  // 4. Line Removal (Advanced horizontal/vertical line detection)
  if (config.removeLines) {
    const minLength = config.lineRemovalLength;
    const maxThickness = config.lineRemovalThickness;
    
    // Horizontal lines
    for (let y = 0; y < height; y++) {
      let run = 0;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4] === 0) {
          run++;
        } else {
          if (run >= minLength) {
            for (let i = x - run; i < x; i++) {
              // Check thickness
              let isThin = true;
              for (let t = 1; t <= maxThickness + 1; t++) {
                const above = y - t >= 0 ? data[((y - t) * width + i) * 4] : 255;
                const below = y + t < height ? data[((y + t) * width + i) * 4] : 255;
                if (above === 0 || below === 0) {
                  if (t > maxThickness) isThin = false;
                  break;
                }
              }
              if (isThin) {
                data[(y * width + i) * 4] = data[(y * width + i) * 4 + 1] = data[(y * width + i) * 4 + 2] = 255;
              }
            }
          }
          run = 0;
        }
      }
    }

    // Vertical lines
    for (let x = 0; x < width; x++) {
      let run = 0;
      for (let y = 0; y < height; y++) {
        if (data[(y * width + x) * 4] === 0) {
          run++;
        } else {
          if (run >= minLength) {
            for (let i = y - run; i < y; i++) {
              // Check thickness
              let isThin = true;
              for (let t = 1; t <= maxThickness + 1; t++) {
                const left = x - t >= 0 ? data[(i * width + x - t) * 4] : 255;
                const right = x + t < width ? data[(i * width + x + t) * 4] : 255;
                if (left === 0 || right === 0) {
                  if (t > maxThickness) isThin = false;
                  break;
                }
              }
              if (isThin) {
                data[(i * width + x) * 4] = data[(i * width + x) * 4 + 1] = data[(i * width + x) * 4 + 2] = 255;
              }
            }
          }
          run = 0;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // 5. Deskewing (Variance-based horizontal projection)
  let bestAngle = 0;
  let maxVariance = -1;

  // Use a smaller canvas for deskewing to save time
  const smallCanvas = document.createElement('canvas');
  const smallCtx = smallCanvas.getContext('2d');
  if (smallCtx) {
    const scale = Math.min(1, 600 / Math.max(width, height));
    smallCanvas.width = width * scale;
    smallCanvas.height = height * scale;
    smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
    
    const smallImageData = smallCtx.getImageData(0, 0, smallCanvas.width, smallCanvas.height);
    const smallData = smallImageData.data;

    // Try angles from -5 to 5 degrees
    for (let angle = -4; angle <= 4; angle += 0.5) {
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rowSums = new Array(smallCanvas.height).fill(0);
      
      const centerX = smallCanvas.width / 2;
      const centerY = smallCanvas.height / 2;

      for (let y = 0; y < smallCanvas.height; y += 2) { // Sample every 2nd row for speed
        for (let x = 0; x < smallCanvas.width; x += 2) { // Sample every 2nd pixel
          // Rotate point (x, y) around center
          const rx = Math.round((x - centerX) * cos - (y - centerY) * sin + centerX);
          const ry = Math.round((x - centerX) * sin + (y - centerY) * cos + centerY);

          if (rx >= 0 && rx < smallCanvas.width && ry >= 0 && ry < smallCanvas.height) {
            const idx = (ry * smallCanvas.width + rx) * 4;
            if (smallData[idx] === 0) rowSums[y]++;
          }
        }
      }
      
      const mean = rowSums.reduce((a, b) => a + b, 0) / rowSums.length;
      const variance = rowSums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rowSums.length;
      
      if (variance > maxVariance) {
        maxVariance = variance;
        bestAngle = angle;
      }
    }
  }

  if (Math.abs(bestAngle) > 0.2) {
    const finalCanvas = document.createElement('canvas');
    const fCtx = finalCanvas.getContext('2d');
    if (fCtx) {
      finalCanvas.width = width;
      finalCanvas.height = height;
      fCtx.fillStyle = 'white';
      fCtx.fillRect(0, 0, width, height);
      fCtx.translate(width / 2, height / 2);
      fCtx.rotate((bestAngle * Math.PI) / 180);
      fCtx.drawImage(canvas, -width / 2, -height / 2);
      return finalCanvas.toDataURL('image/png');
    }
  }

  return canvas.toDataURL('image/png');
};

const Highlight = ({ text, highlight }: { text: string; highlight: string }) => {
  if (!highlight.trim()) {
    return <>{text}</>;
  }
  try {
    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedHighlight})`, 'gi');
    const parts = String(text).split(regex);
    
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className="bg-yellow-300 text-gray-900 rounded-sm px-0.5 font-bold shadow-sm">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch (e) {
    return <>{text}</>;
  }
};

const getDetailedErrorMessage = (err: any): string => {
  let errorStr = err.message || String(err);
  let status = err.status || (err.response && err.response.status);

  // Handle the specific error structure reported by the user: {"error":{"message":"","code":500,"status":"Internal Server Error"}}
  if (err.error && typeof err.error === 'object') {
    status = status || err.error.code;
    if (err.error.message) errorStr = err.error.message;
    else if (err.error.status) errorStr = err.error.status;
  }

  // Try to parse errorStr as JSON if it looks like it
  if (typeof errorStr === 'string' && errorStr.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(errorStr);
      if (parsed.error) {
        status = status || parsed.error.code;
        if (parsed.error.message) errorStr = parsed.error.message;
        else if (parsed.error.status) errorStr = parsed.error.status;
      }
    } catch (e) {}
  }

  const errorStrLower = errorStr.toLowerCase();

  if (errorStr === "EMPTY_RESPONSE") {
    return "AI returned an empty response. This usually happens with very blurry documents or scans that are too dark to read.";
  }
  if (errorStr === "INVALID_API_KEY" || status === 401) {
    return "Invalid or Missing API Key. Please click the Settings (gear icon) to provide a valid Gemini API key or select one via the AI Studio dialog.";
  }
  if (errorStrLower.includes("quota") || errorStrLower.includes("429") || status === 429) {
    return "Rate limit reached (15 requests per minute for Free tier). Please wait about 60 seconds and try again.";
  }
  if (errorStrLower.includes("safety") || (status === 400 && errorStrLower.includes("safety"))) {
    return "Blocked by Safety Filters. The AI detected potentially sensitive content. Try a different document or adjust the scan.";
  }
  if (errorStrLower.includes("fetch") || errorStrLower.includes("networkerror") || errorStrLower.includes("failed to fetch") || errorStrLower.includes("network")) {
    console.error("Network Error Details:", err);
    return "Network Error. Please check your internet connection. If you are using a VPN, try disabling it.";
  }
  if (errorStrLower.includes("model not found") || status === 404) {
    return "AI Model Not Found. The selected Gemini model might be unavailable in your region or has been deprecated.";
  }
  if (errorStrLower.includes("invalid argument") || status === 400) {
    return "Invalid Request. The file might be too large, or the format is not supported by the AI model.";
  }
  if (errorStrLower.includes("deadline exceeded") || status === 504 || errorStrLower.includes("timeout")) {
    return "Request Timed Out. The document is too complex for a single pass. Try processing fewer pages at a time.";
  }
  if (status === 403) {
    return "Access Forbidden. Your API key does not have permission to use this specific model or feature.";
  }
  if (status >= 500 || errorStrLower.includes("internal server error")) {
    return "Gemini Service Error (500). This often happens with large or complex documents. Try processing a smaller file, or try again in a few moments.";
  }
  if (errorStrLower.includes("unexpected token") || errorStrLower.includes("json") || errorStrLower.includes("parse")) {
    return "Data Extraction Error. The AI's output was not in the expected format. Clicking 'Retry' often fixes this.";
  }

  // Fallback for unknown errors
  return `Extraction Error: ${errorStr.substring(0, 150)}${errorStr.length > 150 ? '...' : ''}`;
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
  const [isCapturing, setIsCapturing] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('911234567890');

  const captureTable = async () => {
    const tableElement = document.getElementById('invoice-data-table');
    if (!tableElement) {
      toast.error("Table element not found");
      return;
    }

    setIsCapturing(true);
    const toastId = toast.loading("Capturing table screenshot...");

    try {
      // Small delay to ensure any transitions are finished
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await html2canvas(tableElement, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher quality
        logging: false,
        useCORS: true
      });

      const image = canvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.href = image;
      link.download = `invoice_data_capture_${new Date().getTime()}.png`;
      link.click();
      
      toast.success("Table screenshot captured successfully!", { id: toastId });
    } catch (error) {
      console.error("Capture error:", error);
      toast.error("Failed to capture table screenshot", { id: toastId });
    } finally {
      setIsCapturing(false);
    }
  };

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [isInstructionsSaved, setIsInstructionsSaved] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showScreensaver, setShowScreensaver] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [autoExport, setAutoExport] = useState(true);
  const [selectedFileForOCR, setSelectedFileForOCR] = useState<number | null>(null);
  const [selectedFileForPreview, setSelectedFileForPreview] = useState<number | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [apiKeys, setApiKeys] = useState<{ gemini?: string }>({ gemini: 'AIzaSyDXF7XRr-_KDUqZJ1zaBVn9NLeFSNH-3Og' });
  const [ocrConfig, setOcrConfig] = useState<OCRConfig>({
    language: 'eng',
    psm: '3',
    oem: '3',
    advancedPreprocessing: true,
    pdfScale: 2.0,
    adaptiveThreshold: true,
    thresholdBlockSize: 21,
    thresholdC: 10,
    despeckle: true,
    despeckleRadius: 1,
    removeLines: false,
    lineRemovalLength: 40,
    lineRemovalThickness: 1,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'error'>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [pageCountFilter, setPageCountFilter] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ rowIndex: number, colKey: string } | null>(null);

  const kickUser = (targetId: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'kick', targetId }));
      toast.success("User kicked successfully!");
    }
  };

  // --- Email Export States ---
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('Invoice Data Export');
  const [emailBody, setEmailBody] = useState('Please find the attached invoice data export from SmartInvoice Extractor.');
  const [emailFormat, setEmailFormat] = useState<'csv' | 'json'>('csv');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const filteredFiles = files.filter(f => {
    const matchesStatus = statusFilter === 'all' || f.status === statusFilter;
    const matchesDate = !dateFilter || f.processedDate === dateFilter;
    const matchesPageCount = pageCountFilter === null || f.pageCount === pageCountFilter;
    return matchesStatus && matchesDate && matchesPageCount;
  });

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeUsers, setActiveUsers] = useState<{ id: string; name: string; status: 'online' | 'offline' }[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const myUserIdRef = useRef<string | null>(null);

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

  // --- Real-time Presence Sync ---
  // Keeping everyone in the loop. This WebSocket connection ensures 
  // you're never alone in the workspace.
  useEffect(() => {
    // Fetch global config from server on mount
    fetchGlobalConfig();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'users_update') {
          setActiveUsers(data.users);
        }
        if (data.type === 'user_kicked') {
          // If I'm the one kicked, logout
          if (data.targetId === myUserIdRef.current) {
            setIsLoggedIn(false);
            setUser(null);
            toast.error("You have been kicked by an admin!");
          }
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    };

    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000);

    return () => {
      clearInterval(pingInterval);
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn && user && socketRef.current?.readyState === WebSocket.OPEN) {
      const userId = user.name + '_' + Math.random().toString(36).substr(2, 9);
      myUserIdRef.current = userId;
      socketRef.current.send(JSON.stringify({
        type: 'login',
        userId: userId,
        name: user.name
      }));
    }
  }, [isLoggedIn, user]);

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
  
  // Settings History for Undo/Redo
  const [settingsHistory, setSettingsHistory] = useState<{
    apiKeys: { gemini?: string };
    ocrConfig: OCRConfig;
    autoExport: boolean;
  }[]>([]);
  const [historyPointer, setHistoryPointer] = useState(-1);

  const pushToHistory = (newSettings: {
    apiKeys: { gemini?: string };
    ocrConfig: OCRConfig;
    autoExport: boolean;
  }) => {
    setSettingsHistory(prev => {
      const newHistory = prev.slice(0, historyPointer + 1);
      return [...newHistory, JSON.parse(JSON.stringify(newSettings))];
    });
    setHistoryPointer(prev => prev + 1);
  };

  const undoSettings = () => {
    if (historyPointer > 0) {
      const prevState = settingsHistory[historyPointer - 1];
      setApiKeys(prevState.apiKeys);
      setOcrConfig(prevState.ocrConfig);
      setAutoExport(prevState.autoExport);
      setHistoryPointer(prev => prev - 1);
      toast.success("Settings undone");
    }
  };

  const redoSettings = () => {
    if (historyPointer < settingsHistory.length - 1) {
      const nextState = settingsHistory[historyPointer + 1];
      setApiKeys(nextState.apiKeys);
      setOcrConfig(nextState.ocrConfig);
      setAutoExport(nextState.autoExport);
      setHistoryPointer(prev => prev + 1);
      toast.success("Settings redone");
    }
  };
  useEffect(() => {
    const savedKeys = localStorage.getItem('invoice_extractor_api_keys');
    const initialKeys = savedKeys ? JSON.parse(savedKeys) : { gemini: 'w7w1AD7uSe3Jn4DfEcY8emLQJsxUj5A5nnfwzB0c' };
    
    const savedOcr = localStorage.getItem('invoice_extractor_ocr_config');
    const initialOcr = savedOcr ? JSON.parse(savedOcr) : {
      language: 'eng',
      psm: '3',
      oem: '3',
      advancedPreprocessing: true,
      pdfScale: 2.0,
      adaptiveThreshold: true,
      thresholdBlockSize: 21,
      thresholdC: 10,
      despeckle: true,
      despeckleRadius: 1,
      removeLines: false,
      lineRemovalLength: 40,
      lineRemovalThickness: 1,
    };

    if (savedKeys) {
      try {
        setApiKeys(JSON.parse(savedKeys));
      } catch (e) {
        console.error("Failed to parse saved API keys", e);
      }
    } else {
      const defaultKeys = { gemini: 'AIzaSyDXF7XRr-_KDUqZJ1zaBVn9NLeFSNH-3Og' };
      setApiKeys(defaultKeys);
      localStorage.setItem('invoice_extractor_api_keys', JSON.stringify(defaultKeys));
    }

    if (savedOcr) {
      try {
        setOcrConfig(JSON.parse(savedOcr));
      } catch (e) {
        console.error("Failed to parse saved OCR config", e);
      }
    }

    const savedWhatsApp = localStorage.getItem('invoice_extractor_whatsapp');
    if (savedWhatsApp) {
      setWhatsappNumber(savedWhatsApp);
    }

    // Initialize history
    setSettingsHistory([{
      apiKeys: initialKeys,
      ocrConfig: initialOcr,
      autoExport: autoExport
    }]);
    setHistoryPointer(0);
  }, []);

  const saveApiKeys = (keys: { gemini?: string }) => {
    setApiKeys(keys);
    localStorage.setItem('invoice_extractor_api_keys', JSON.stringify(keys));
    pushToHistory({ apiKeys: keys, ocrConfig, autoExport });
  };

  const saveOcrConfig = (config: OCRConfig) => {
    setOcrConfig(config);
    localStorage.setItem('invoice_extractor_ocr_config', JSON.stringify(config));
    pushToHistory({ apiKeys, ocrConfig: config, autoExport });
  };

  const toggleAutoExport = (val: boolean) => {
    setAutoExport(val);
    pushToHistory({ apiKeys, ocrConfig, autoExport: val });
  };

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
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);

  useEffect(() => {
    const savedColumns = localStorage.getItem('invoice_extractor_columns');
    if (savedColumns) {
      try {
        const parsed = JSON.parse(savedColumns);
        if (Array.isArray(parsed)) {
          // Merge with default columns to ensure new columns are added if any
          const defaultColumns: ColumnConfig[] = [
            { key: 'srNo', label: 'Sr. No.', enabled: true },
            { key: 'invoiceNumber', label: 'Invoice Number', enabled: true },
            { key: 'invoiceDate', label: 'Invoice Date', enabled: true },
            { key: 'materialModel', label: 'Material/Code', enabled: true },
            { key: 'descriptionProduct', label: 'Product/Description', enabled: true },
            { key: 'hsCode', label: 'Tariffcode/HS Code', enabled: true },
            { key: 'qty', label: 'Qty', enabled: true },
            { key: 'valueAmount', label: 'Amount', enabled: true },
            { key: 'originCOO', label: 'COO/Origin', enabled: true },
          ];
          
          const merged = parsed.map(p => {
            const def = defaultColumns.find(d => d.key === p.key);
            return def ? { ...def, enabled: p.enabled } : null;
          }).filter(Boolean) as ColumnConfig[];

          // Add any missing default columns
          defaultColumns.forEach(def => {
            if (!merged.find(m => m.key === def.key)) {
              merged.push(def);
            }
          });
          
          setColumns(merged);
        }
      } catch (e) {
        console.error("Failed to load columns from localStorage", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('invoice_extractor_columns', JSON.stringify(columns));
  }, [columns]);

  const handleColumnDragStart = (index: number) => {
    setDraggedColumnIndex(index);
  };

  const handleColumnDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const generateFilePreviews = async (index: number) => {
    const fileStatus = files[index];
    if (!fileStatus) return;

    setIsGeneratingPreview(true);
    try {
      let originalUrl = "";
      let preprocessedUrl = "";

      if (fileStatus.file.type === 'application/pdf') {
        const arrayBuffer = await fileStatus.file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1); // Preview first page
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ 
          canvasContext: context, 
          viewport,
          canvas: canvas as any
        }).promise;
        originalUrl = canvas.toDataURL('image/png');
        preprocessedUrl = await preprocessImage(canvas, ocrConfig);
      } else {
        const img = new Image();
        const objectUrl = URL.createObjectURL(fileStatus.file);
        img.src = objectUrl;
        await new Promise((resolve) => { img.onload = resolve; });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          originalUrl = canvas.toDataURL('image/png');
          preprocessedUrl = await preprocessImage(canvas, ocrConfig);
        }
        URL.revokeObjectURL(objectUrl);
      }

      setFiles(prev => prev.map((f, i) => i === index ? { ...f, originalPreview: originalUrl, preprocessedPreview: preprocessedUrl } : f));
      setSelectedFileForPreview(index);
    } catch (e) {
      console.error("Error generating previews:", e);
      toast.error("Failed to generate preview");
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  const toggleFilePreprocessing = (index: number) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, usePreprocessing: !f.usePreprocessing } : f));
  };

  const handleColumnDrop = (index: number) => {
    if (draggedColumnIndex === null || draggedColumnIndex === index) return;

    const newColumns = [...columns];
    const draggedCol = newColumns[draggedColumnIndex];
    newColumns.splice(draggedColumnIndex, 1);
    newColumns.splice(index, 0, draggedCol);
    
    setColumns(newColumns);
    setDraggedColumnIndex(null);
    toast.success("Column order updated");
  };
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 200;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let idleTimer: any;
    const idleTime = 120000; // 2 minutes

    const resetTimer = () => {
      setShowScreensaver(false);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (isLoggedIn && !isProcessing) {
          setShowScreensaver(true);
        }
      }, idleTime);
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    if (isLoggedIn) {
      events.forEach(event => window.addEventListener(event, resetTimer));
      resetTimer();
    }

    return () => {
      events.forEach(event => window.removeEventListener(event, resetTimer));
      clearTimeout(idleTimer);
    };
  }, [isLoggedIn, isProcessing]);

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

  const toggleErrorExpansion = (index: number) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
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
  const totalInQueue = files.length;
  
  // Calculate accurate progress: sum of all file progress / total files
  const totalProgress = files.reduce((acc, f) => {
    if (f.status === 'completed' || f.status === 'error') return acc + 100;
    if (f.status === 'processing') return acc + (f.progress || 0);
    return acc;
  }, 0);
  
  const progressPercentage = totalInQueue > 0 
    ? Math.min((totalProgress / totalInQueue), 99.9) 
    : 0;
    
  // If all are done, show 100%
  const finalProgress = (processedCount === totalInQueue && totalInQueue > 0) ? 100 : progressPercentage;
  
  const currentFile = files.find(f => f.status === 'processing');

  const Screensaver = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center overflow-hidden"
      onClick={() => setShowScreensaver(false)}
    >
      {/* Animated Background Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            x: [-100, 100, -100],
            y: [-100, 100, -100]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]"
        />
        <motion.div 
          animate={{ 
            scale: [1.2, 1, 1.2],
            rotate: [0, -90, 0],
            x: [100, -100, 100],
            y: [100, -100, 100]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-red-600/20 rounded-full blur-[150px]"
        />
        <motion.div 
          animate={{ 
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.1, 1]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-600/10 rounded-full blur-[200px]"
        />
      </div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="relative z-10 flex flex-col items-center text-center"
      >
        <motion.div
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 5, -5, 0]
          }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="mb-12"
        >
          <img 
            src="https://cdn3d.iconscout.com/3d/premium/thumb/invoice-6332629-5220370.png" 
            alt="3D Invoice" 
            className="h-48 w-48 object-contain drop-shadow-[0_20px_50px_rgba(37,99,235,0.5)]"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        <h2 className="text-6xl font-black text-white mb-4 tracking-tighter">
          {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="text-blue-500 ml-1"
          >
            :
          </motion.span>
          <span className="text-4xl ml-1 opacity-50">
            {currentTime.toLocaleTimeString([], { second: '2-digit' })}
          </span>
        </h2>

        <div className="flex flex-col items-center gap-2">
          <p className="text-xl font-bold text-blue-400 uppercase tracking-[0.3em]">
            SmartInvoice Pro
          </p>
          <p className="text-sm text-white/40 font-medium uppercase tracking-widest">
            AI-Powered Extraction Engine
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          className="mt-24 flex items-center gap-3 text-white/20"
        >
          <div className="w-12 h-px bg-white/10" />
          <p className="text-[10px] font-bold uppercase tracking-[0.5em]">Move mouse to wake</p>
          <div className="w-12 h-px bg-white/10" />
        </motion.div>
      </motion.div>

      {/* Floating Particles */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ 
            x: Math.random() * window.innerWidth, 
            y: Math.random() * window.innerHeight,
            opacity: Math.random() * 0.5
          }}
          animate={{ 
            x: Math.random() * window.innerWidth, 
            y: Math.random() * window.innerHeight,
            opacity: [0.2, 0.5, 0.2]
          }}
          transition={{ 
            duration: 10 + Math.random() * 20, 
            repeat: Infinity, 
            ease: "linear" 
          }}
          className="absolute w-1 h-1 bg-white rounded-full"
        />
      ))}
    </motion.div>
  );

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const username = loginForm.username.trim();
    const password = loginForm.password;

    if (!username || !password) {
      setLoginError("Please enter both username and password");
      return;
    }

    if (username.toLowerCase() === 'admin' && password === 'BV@@mumbai@@786') {
      const newUser = { name: 'Admin', role: 'admin' as const };
      setUser(newUser);
      setIsLoggedIn(true);
      // Ensure API key is selected for Gemini 3 models
      checkApiKey();
    } else if (password === 'BV@2026') {
      const newUser = { name: username, role: 'user' as const };
      setUser(newUser);
      setIsLoggedIn(true);
      // Ensure API key is selected for Gemini 3 models
      checkApiKey();
    } else {
      setLoginError("Invalid username or password");
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
        return { 
          id: Math.random().toString(36).substr(2, 9),
          file: f, 
          status: 'pending' as const, 
          pageCount,
          usePreprocessing: true
        };
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
      <>
        <Toaster position="top-right" />
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
              whileHover={{ rotate: 10, scale: 1.1, y: -5 }}
              className="mb-5 drop-shadow-2xl"
            >
              <img 
                src="https://cdn3d.iconscout.com/3d/premium/thumb/invoice-6332629-5220370.png" 
                alt="3D Invoice" 
                className="h-24 w-24 object-contain"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">SmartInvoice Pro</h1>
            <p className="text-gray-500 text-sm font-bold mt-2 uppercase tracking-widest">AI-Powered Extraction Engine</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 ml-1">User Identity</label>
              <div className="relative">
                <User className="w-5 h-5 text-blue-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  value={loginForm.username ?? ""}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full bg-gray-50/50 border-2 border-gray-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-sm font-bold"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 ml-1">Secure Access</label>
              <div className="relative">
                <Lock className="w-5 h-5 text-red-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="password"
                  value={loginForm.password ?? ""}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full bg-gray-50/50 border-2 border-gray-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-red-500 focus:bg-white transition-all text-sm font-bold"
                  placeholder="••••••••"
                />
              </div>
            </div>

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
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Developed by Dinesh JAISWAL</p>
          </div>
        </motion.div>
      </div>
    </>
    );
  }

  const retryFile = (index: number) => {
    setFiles(prev => prev.map((f, i) => 
      i === index ? { ...f, status: 'pending', error: undefined, progress: 0, statusText: 'Retrying...' } : f
    ));
  };

  const reprocessFile = (index: number) => {
    // When reprocessing, we keep the file but set it back to pending
    // We don't clear all data, but the next extraction will append new items
    // (User might want to clear data first, but this allows selective re-processing)
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'pending', error: undefined, statusText: undefined } : f));
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

  const performOCR = async (file: File, usePreprocessing: boolean, onProgress?: (p: number) => void): Promise<{ text: string, pageCount: number }> => {
    try {
      if (!file) throw new Error("No file provided for OCR");
      
      let fullText = "";
      let pageCount = 1;

      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        pageCount = pdf.numPages;

        // Create a scheduler for parallel processing
        const scheduler = Tesseract.createScheduler();
        // Use up to 4 workers or hardware concurrency
        const numWorkers = Math.min(4, navigator.hardwareConcurrency || 4);
        
        const workers = await Promise.all(
          Array(numWorkers).fill(0).map(async () => {
            const worker = await Tesseract.createWorker(ocrConfig.language, parseInt(ocrConfig.oem));
            await worker.setParameters({
              tessedit_pageseg_mode: ocrConfig.psm as any,
            });
            return worker;
          })
        );

        workers.forEach(w => scheduler.addWorker(w));

        const pageResults = new Array(pageCount);
        
        // Process pages in chunks to avoid memory exhaustion
        const concurrencyLimit = 2;
        for (let i = 1; i <= pageCount; i += concurrencyLimit) {
          const chunk = [];
          for (let j = 0; j < concurrencyLimit && (i + j) <= pageCount; j++) {
            const pageNum = i + j;
            chunk.push((async () => {
              try {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: ocrConfig.pdfScale });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) throw new Error("Could not create canvas context");
                
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({
                  canvasContext: context,
                  viewport,
                  canvas: canvas as any
                }).promise;

                const imageSource = usePreprocessing 
                  ? await preprocessImage(canvas, ocrConfig)
                  : canvas.toDataURL('image/png');
                
                const { data: { text } } = await scheduler.addJob('recognize', imageSource);
                
                pageResults[pageNum - 1] = `--- PAGE ${pageNum} ---\n${text}\n\n`;
                
                if (onProgress) {
                  const completedPages = pageResults.filter(r => r !== undefined).length;
                  onProgress((completedPages / pageCount) * 100);
                }
              } catch (err: any) {
                console.error(`Error on page ${pageNum}:`, err);
                pageResults[pageNum - 1] = `--- PAGE ${pageNum} (Failed) ---\n${err.message}\n\n`;
              }
            })());
          }
          await Promise.all(chunk);
        }

        await scheduler.terminate();
        fullText = pageResults.join("");
      } else {
        // Single image optimization: reuse one worker
        const worker = await Tesseract.createWorker(ocrConfig.language, parseInt(ocrConfig.oem), {
          logger: m => {
            if (m.status === 'recognizing text' && onProgress) {
              onProgress(m.progress * 100);
            }
          }
        });
        
        await worker.setParameters({
          tessedit_pageseg_mode: ocrConfig.psm as any,
        });

        let imageSource: string | File = file;
        
        if (usePreprocessing) {
          const img = new Image();
          const objectUrl = URL.createObjectURL(file);
          img.src = objectUrl;
          await new Promise((resolve) => { img.onload = resolve; });
          
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            imageSource = await preprocessImage(canvas, ocrConfig);
          }
          URL.revokeObjectURL(objectUrl);
        }

        const { data: { text } } = await worker.recognize(imageSource);
        await worker.terminate();
        fullText = text;
      }

      return { text: fullText, pageCount };
    } catch (error: any) {
      console.error("OCR Overall Error:", error);
      const errorMessage = error.message || "Unknown OCR error";
      toast.error(`OCR Error: ${errorMessage}`);
      return { text: `OCR failed: ${errorMessage}`, pageCount: 0 };
    }
  };


  // --- The Brain: AI Data Extraction ---
  // This is where the magic happens. We send the raw OCR text to Gemini
  // and it returns a perfectly structured JSON array. No regex, just pure intelligence.
  const processFiles = async () => {
    // Ensure API key is selected first for Gemini 3 models
    await checkApiKey();
    
    const pendingFiles = files.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsProcessing(true);
    setError(null);
    const allExtractedItems: InvoiceItem[] = [];

    try {
      // Prioritize environment key, then global key from server, then user provided key
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || globalGeminiKey || apiKeys.gemini;
      
      if (!apiKey || apiKey.length < 10) throw new Error("INVALID_API_KEY");

      const ai = new GoogleGenAI({ apiKey });
      
      // Use Flash model for better compatibility and speed
      const CONCURRENCY_LIMIT = 3;
      const queue = [...files.map((f, i) => ({ file: f, index: i }))].filter(item => item.file.status === 'pending');
      
      const processQueue = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          
          const { file, index: i } = item;

          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing', progress: 0, statusText: 'Initializing...' } : f));

          let progressInterval: any;

          try {
            let base64Data: string;
            let rawText = "";

            if (file.file.type.startsWith('image/')) {
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Optimizing image...' } : f));
              // Compress images for faster upload/processing
              base64Data = await compressImage(file.file);
            } else {
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Reading PDF...' } : f));
              // For PDFs, just read as base64
              base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file.file);
              });
            }

            // Perform OCR in parallel with AI analysis if possible, or as a separate step
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Extracting text (OCR)...' } : f));
            const ocrResult = await performOCR(file.file, file.usePreprocessing, (p) => {
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: p * 0.3 } : f));
            });
            rawText = ocrResult.text;
            const ocrPageCount = ocrResult.pageCount;

            // Truncate raw text if it's exceptionally large to avoid token limits or 500s
            const MAX_RAW_TEXT = 40000;
            if (rawText.length > MAX_RAW_TEXT) {
              console.warn(`[Truncating Raw Text] ${file.file.name}: ${rawText.length} -> ${MAX_RAW_TEXT}`);
              rawText = rawText.substring(0, MAX_RAW_TEXT) + "\n... [Text Truncated due to size] ...";
            }
            
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, rawText, pageCount: ocrPageCount, statusText: 'AI Analyzing layout...' } : f));
            
            progressInterval = setInterval(() => {
              setFiles(prev => prev.map((f, idx) => {
                if (idx === i && f.status === 'processing' && (f.progress || 0) < 92) {
                  return { ...f, progress: (f.progress || 0) + Math.random() * 8 };
                }
                return f;
              }));
            }, 500);

            const fileInstructions = file.customInstructions || customInstructions;
            const isPackingList = file.file.name.toLowerCase().includes('pl') || file.file.name.toLowerCase().includes('packing');
            
            const promptText = `Extract invoice/packing list data: srNo, invoiceNumber, invoiceDate, materialModel, descriptionProduct, hsCode, qty, valueAmount, originCOO.
            Also count total pages as "pageCount".
            
            ${isPackingList ? "NOTE: This appears to be a Packing List. If 'valueAmount' is not explicitly listed, use 0 or look for unit values. If 'invoiceNumber' or 'invoiceDate' are not found, use placeholders like 'N/A'." : ""}
            
            ${rawText ? `Below is the raw text extracted via OCR to help you:
            ---
            ${rawText}
            ---` : ""}

            Return JSON: { "items": [...], "pageCount": number }. ${fileInstructions ? `Instructions: ${fileInstructions}` : ""}`;
            
            let response;
            const isLargeFile = base64Data.length > 12 * 1024 * 1024; // ~9MB binary - being conservative to avoid 500s
            
            try {
              // 1. Try Multimodal Flash (Skip if file is too large for inline data)
              if (isLargeFile) throw new Error("FILE_TOO_LARGE_FOR_MULTIMODAL");
              
              response = await retry(async () => {
                return await ai.models.generateContent({
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
                    temperature: 0.1,
                  }
                });
              }, 2, 2000);
            } catch (flashErr: any) {
              console.warn(`[Flash Multimodal Failed] ${file.file.name}:`, flashErr);
              
              // 2. Try Multimodal Pro as fallback for 500s or complex files
              try {
                if (isLargeFile) throw new Error("FILE_TOO_LARGE_FOR_MULTIMODAL");
                setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Retrying with Pro model...' } : f));
                response = await retry(async () => {
                  return await ai.models.generateContent({
                    model: "gemini-3.1-pro-preview",
                    contents: [{
                      parts: [
                        { text: promptText },
                        { inlineData: { mimeType: file.file.type.startsWith('image/') ? 'image/jpeg' : file.file.type, data: base64Data } }
                      ]
                    }],
                    config: {
                      responseMimeType: "application/json",
                      responseSchema: EXTRACTION_SCHEMA,
                      temperature: 0.1,
                    }
                  });
                }, 1, 3000);
              } catch (proErr: any) {
                console.warn(`[Pro Multimodal Failed] ${file.file.name}:`, proErr);
                
                // 3. Try Text-only Flash
                if (!rawText) throw proErr; // No text to fall back to
                
                setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Retrying with text-only mode...' } : f));
                try {
                  response = await retry(async () => {
                    return await ai.models.generateContent({
                      model: "gemini-3-flash-preview",
                      contents: [{
                        parts: [
                          { text: promptText }
                        ]
                      }],
                      config: {
                        responseMimeType: "application/json",
                        responseSchema: EXTRACTION_SCHEMA,
                        temperature: 0.1,
                      }
                    });
                  }, 1, 2000);
                } catch (textFlashErr: any) {
                   // 4. Final attempt: Text-only Pro
                   console.warn(`[Flash Text Failed] ${file.file.name}:`, textFlashErr);
                   setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Final attempt with Pro text-only...' } : f));
                   response = await retry(async () => {
                    return await ai.models.generateContent({
                      model: "gemini-3.1-pro-preview",
                      contents: [{
                        parts: [
                          { text: promptText }
                        ]
                      }],
                      config: {
                        responseMimeType: "application/json",
                        responseSchema: EXTRACTION_SCHEMA,
                        temperature: 0.1,
                      }
                    });
                  }, 1, 3000);
                }
              }
            }

            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, statusText: 'Processing results...' } : f));

            if (!response.text) throw new Error("EMPTY_RESPONSE");

            const cleanJson = response.text.replace(/```json|```/g, '').trim();
            const result = JSON.parse(cleanJson) as ExtractionResult;
            
            clearInterval(progressInterval);
            if (result.items && result.items.length > 0) {
              const itemsWithId = result.items.map(item => ({ ...item, fileId: files[i].id }));
              allExtractedItems.push(...itemsWithId);
              setData(prev => [...prev, ...itemsWithId]);
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'completed', pageCount: result.pageCount || f.pageCount, progress: 100, statusText: 'Success', rawText: f.rawText || rawText, processedDate: new Date().toISOString().split('T')[0] } : f));
            } else {
              setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: "No items found", progress: 0, statusText: 'Failed' } : f));
            }
          } catch (err: any) {
            clearInterval(progressInterval);
            console.error(`[Extraction Error] ${file.file.name}:`, err);
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: getDetailedErrorMessage(err), progress: 0, statusText: 'Error' } : f));
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
      setError(getDetailedErrorMessage(globalErr));
    } finally {
      setIsProcessing(false);
      if (allExtractedItems.length > 0 && autoExport) {
        // Small delay to ensure UI updates before download starts
        toast("Auto-exporting to Excel...", { icon: '📊' });
        setTimeout(() => {
          exportToExcel(allExtractedItems);
        }, 800);
      }
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

  const handleRefine = async () => {
    if (!refinePrompt.trim() || data.length === 0) return;
    
    // Ensure API key is selected first for Gemini 3 models
    await checkApiKey();
    
    setIsRefining(true);
    const toastId = toast.loading("Refining data with AI...");
    
    try {
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || globalGeminiKey || apiKeys.gemini;
      if (!apiKey) throw new Error("API Key missing");

      const ai = new GoogleGenAI({ apiKey });
      
      // Collect all raw text for context
      const allRawText = files
        .filter(f => f.status === 'completed' && f.rawText)
        .map(f => `FILE: ${f.file.name}\nCONTENT:\n${f.rawText}`)
        .join('\n\n---\n\n');

      const prompt = `
        You are an expert data analyst. I have extracted invoice data into a table, but I need to refine it.
        
        USER REQUEST: "${refinePrompt}"
        
        CURRENT TABLE DATA (JSON):
        ${JSON.stringify(data, null, 2)}
        
        RAW TEXT FROM INVOICES (for context):
        ${allRawText}
        
        INSTRUCTIONS:
        1. Apply the user's request to the current table data.
        2. If the user asks for new fields, look at the RAW TEXT to find them.
        3. If the user asks for logic (e.g., "Convert to USD"), apply it to the existing data.
        4. Return the ENTIRE updated table as a JSON array of objects.
        5. Maintain the existing structure but add or update fields as requested.
        6. Return ONLY the JSON array.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      if (!response.text) throw new Error("EMPTY_RESPONSE");
      const cleanJson = response.text.replace(/```json|```/g, '').trim();
      const updatedData = JSON.parse(cleanJson);
      if (Array.isArray(updatedData)) {
        // Update columns if new keys are found
        const allKeys = new Set<string>();
        updatedData.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
        
        setColumns(prev => {
          const existingKeys = new Set(prev.map(c => c.key));
          const newCols = [...prev];
          allKeys.forEach(key => {
            if (!existingKeys.has(key)) {
              newCols.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'), enabled: true });
            }
          });
          return newCols;
        });

        setData(updatedData);
        toast.success("Data refined successfully", { id: toastId });
        setRefinePrompt('');
      } else {
        throw new Error("Invalid response format from AI");
      }
    } catch (err: any) {
      console.error("Refine Error:", err);
      toast.error(`Refine failed: ${getDetailedErrorMessage(err)}`, { id: toastId });
    } finally {
      setIsRefining(false);
    }
  };

  const clearAllData = () => {
    // We use a simple state-based confirmation since window.confirm is discouraged in iframes
    if (data.length === 0 && files.length === 0) {
      toast.error("Nothing to clear");
      return;
    }
    
    setData([]);
    setFiles([]);
    setHistory({ stack: [[]], index: 0 });
    setCurrentPage(1);
    toast.success("All history and data cleared successfully");
  };

  const addRow = () => {
    const newRow: InvoiceItem = {
      srNo: (data.length + 1).toString(),
      invoiceNumber: '',
      invoiceDate: '',
      materialModel: '',
      descriptionProduct: '',
      hsCode: '',
      qty: 0,
      valueAmount: 0,
      originCOO: '',
      fileId: 'manual'
    };
    const newData = [...data, newRow];
    setData(newData);
  };

  const deleteRow = (index: number) => {
    const newData = data.filter((_, i) => i !== index);
    setData(newData);
  };

  const exportToExcel = (dataToExport?: InvoiceItem[] | any) => {
    try {
      const sourceData = Array.isArray(dataToExport) ? dataToExport : data;
      if (!sourceData || sourceData.length === 0) {
        toast.error("No data available to export");
        return;
      }
      
      const exportData = sourceData.map(item => {
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
      toast.success("Excel export successful");
    } catch (err: any) {
      console.error("Excel Export Error:", err);
      toast.error(`Excel export failed: ${err.message || "Unknown error"}`);
    }
  };

  const exportToCSV = () => {
    try {
      if (data.length === 0) {
        toast.error("No data available to export");
        return;
      }
      
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
      URL.revokeObjectURL(url);
      toast.success("CSV export successful");
    } catch (err: any) {
      console.error("CSV Export Error:", err);
      toast.error(`CSV export failed: ${err.message || "Unknown error"}`);
    }
  };

  const exportToJSON = () => {
    try {
      if (data.length === 0) {
        toast.error("No data available to export");
        return;
      }
      
      const exportData = data.map(item => {
        const row: any = {};
        columns.forEach(col => {
          row[col.key] = item[col.key];
        });
        return row;
      });

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Invoices_Export_${new Date().toISOString().split('T')[0]}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("JSON export successful");
    } catch (err: any) {
      console.error("JSON Export Error:", err);
      toast.error(`JSON export failed: ${err.message || "Unknown error"}`);
    }
  };

  const sendEmailExport = async () => {
    if (!emailTo || !emailSubject) {
      toast.error("Please provide recipient email and subject");
      return;
    }

    setIsSendingEmail(true);
    setEmailError(null);
    setEmailSuccess(false);

    try {
      let exportData: any;
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `Invoices_Export_${dateStr}`;

      const cleanData = data.map(item => {
        const row: any = {};
        columns.forEach(col => {
          row[col.key] = item[col.key];
        });
        return row;
      });

      if (emailFormat === 'json') {
        exportData = cleanData;
      } else {
        // Generate CSV string
        const worksheet = XLSX.utils.json_to_sheet(cleanData);
        exportData = XLSX.utils.sheet_to_csv(worksheet);
      }

      const response = await fetch('/api/export/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: emailTo,
          subject: emailSubject,
          body: emailBody,
          format: emailFormat,
          data: exportData,
          filename
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send email");
      }

      setEmailSuccess(true);
      toast.success("Email sent successfully!");
      setTimeout(() => setShowEmailModal(false), 2000);
    } catch (err: any) {
      console.error("Email Export Error:", err);
      setEmailError(err.message);
      toast.error(err.message);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const exportAllFormats = async () => {
    try {
      if (data.length === 0) {
        toast.error("No data available to export");
        return;
      }

      const zip = new JSZip();
      const dateStr = new Date().toISOString().split('T')[0];
      const folder = zip.folder(`Invoices_Export_${dateStr}`);

      if (!folder) throw new Error("Could not create zip folder");

      // 1. Prepare Excel
      const excelExportData = data.map(item => {
        const row: any = {};
        columns.forEach(col => {
          if (col.enabled) {
            row[col.label] = item[col.key];
          }
        });
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(excelExportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Data");
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      folder.file(`Invoices_Export_${dateStr}.xlsx`, excelBuffer);

      // 2. Prepare CSV
      const csvExportData = data.map(item => {
        const row: any = {};
        columns.forEach(col => {
          row[col.label] = item[col.key];
        });
        return row;
      });
      const csvWorksheet = XLSX.utils.json_to_sheet(csvExportData);
      const csv = XLSX.utils.sheet_to_csv(csvWorksheet);
      folder.file(`Invoices_Full_Export_${dateStr}.csv`, csv);

      // 3. Prepare JSON
      const jsonExportData = data.map(item => {
        const row: any = {};
        columns.forEach(col => {
          row[col.key] = item[col.key];
        });
        return row;
      });
      const jsonString = JSON.stringify(jsonExportData, null, 2);
      folder.file(`Invoices_Export_${dateStr}.json`, jsonString);

      // Generate and download zip
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Invoices_Full_Bundle_${dateStr}.zip`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Bundle export successful");
    } catch (err: any) {
      console.error("Bundle Export Error:", err);
      toast.error(`Bundle export failed: ${err.message || "Unknown error"}`);
    }
  };

  const reset = () => {
    setFiles([]);
    setData([]);
    setError(null);
    setCurrentPage(1);
    setHistory({ stack: [], index: -1 });
  };

  const filteredData = data.filter(item => {
    if (item.fileId === 'manual') {
      return statusFilter === 'all' && !dateFilter && pageCountFilter === null && 
        Object.values(item).some(val => 
          String(val).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    const file = files.find(f => f.id === item.fileId);
    if (!file) return false;

    const matchesStatus = statusFilter === 'all' || file.status === statusFilter;
    const matchesDate = !dateFilter || file.processedDate === dateFilter;
    const matchesPageCount = pageCountFilter === null || file.pageCount === pageCountFilter;

    if (!matchesStatus || !matchesDate || !matchesPageCount) return false;

    return Object.values(item).some(val => 
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + rowsPerPage);

  return (
    <>
      <Toaster position="top-right" />
      
      {/* Global Top Progress Bar */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 h-1 z-[100] bg-gray-100"
          >
            <motion.div 
              className="h-full bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.8)]"
              initial={{ width: 0 }}
              animate={{ width: `${finalProgress}%` }}
              transition={{ type: "spring", stiffness: 50, damping: 20 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScreensaver && <Screensaver />}
      </AnimatePresence>

      {/* Email Export Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-purple-50/50">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-600 p-2 rounded-xl shadow-lg shadow-purple-200">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Export via Email</h3>
                    <p className="text-[10px] text-purple-600 font-black uppercase tracking-widest">Send extracted data directly</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowEmailModal(false)}
                  className="p-2 hover:bg-white rounded-full transition-colors shadow-sm border border-transparent hover:border-gray-100"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {emailSuccess ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="py-8 text-center space-y-4"
                  >
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-gray-900">Email Sent!</h4>
                      <p className="text-sm text-gray-500">Your invoice data has been dispatched.</p>
                    </div>
                  </motion.div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Recipient Email</label>
                      <div className="relative">
                        <input
                          type="email"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          placeholder="e.g., accounts@company.com"
                          className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          <User className="w-4 h-4 text-gray-300" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Subject Line</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        placeholder="Enter email subject..."
                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Export Format</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setEmailFormat('csv')}
                          className={cn(
                            "py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all border-2 flex items-center justify-center gap-2",
                            emailFormat === 'csv' 
                              ? "bg-purple-50 border-purple-500 text-purple-700 shadow-lg shadow-purple-100" 
                              : "bg-gray-50 border-gray-100 text-gray-400 hover:border-gray-200"
                          )}
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          CSV
                        </button>
                        <button
                          onClick={() => setEmailFormat('json')}
                          className={cn(
                            "py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all border-2 flex items-center justify-center gap-2",
                            emailFormat === 'json' 
                              ? "bg-purple-50 border-purple-500 text-purple-700 shadow-lg shadow-purple-100" 
                              : "bg-gray-50 border-gray-100 text-gray-400 hover:border-gray-200"
                          )}
                        >
                          <FileJson className="w-4 h-4" />
                          JSON
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Message (Optional)</label>
                      <textarea
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        placeholder="Add a note to the recipient..."
                        rows={3}
                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none"
                      />
                    </div>

                    {emailError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <p className="text-[10px] font-bold leading-tight">{emailError}</p>
                      </div>
                    )}

                    <button
                      onClick={sendEmailExport}
                      disabled={isSendingEmail || !emailTo}
                      className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white py-4 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all shadow-xl shadow-purple-100 flex items-center justify-center gap-2 mt-2"
                    >
                      {isSendingEmail ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send Export
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
        {selectedFileForOCR !== null && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFileForOCR(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-xl">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">OCR Raw Text</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{files[selectedFileForOCR].file.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFileForOCR(null)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <div className="p-6 overflow-auto flex-1">
                <div className="bg-gray-50 rounded-2xl p-6 font-mono text-xs leading-relaxed text-gray-600 whitespace-pre-wrap border border-gray-100">
                  {files[selectedFileForOCR].rawText || "No text extracted."}
                </div>
              </div>
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(files[selectedFileForOCR].rawText || "");
                    toast.success("OCR text copied to clipboard");
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all"
                >
                  <Copy className="w-4 h-4" /> Copy Text
                </button>
                <button
                  onClick={() => setSelectedFileForOCR(null)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Preprocessing Preview Modal */}
        {selectedFileForPreview !== null && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFileForPreview(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2.5rem] shadow-2xl border border-white/20 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh] z-10"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white/50 backdrop-blur-xl">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-500/10 p-3 rounded-2xl">
                    <Eye className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-900 tracking-tight">Preprocessing Preview</h3>
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{files[selectedFileForPreview].file.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFileForPreview(null)}
                  className="p-3 hover:bg-gray-100 rounded-2xl text-gray-400 transition-all hover:rotate-90"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-8 bg-[#F8F9FA]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Original Image */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Original Image</h4>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-bold">RAW</span>
                    </div>
                    <div className="bg-white p-4 rounded-[2rem] border border-gray-100 shadow-xl overflow-hidden flex items-center justify-center min-h-[400px]">
                      {files[selectedFileForPreview].originalPreview ? (
                        <img 
                          src={files[selectedFileForPreview].originalPreview} 
                          alt="Original" 
                          className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-sm"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-gray-300">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <span className="text-xs font-bold uppercase tracking-widest">Loading...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Preprocessed Image */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h4 className="text-xs font-black text-blue-500 uppercase tracking-widest">Preprocessed Image</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-full font-bold">ADAPTIVE THRESHOLD</span>
                        <button
                          onClick={() => toggleFilePreprocessing(selectedFileForPreview!)}
                          className={cn(
                            "text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border transition-all flex items-center gap-1",
                            files[selectedFileForPreview].usePreprocessing 
                              ? "bg-emerald-500 text-white border-emerald-600 shadow-lg shadow-emerald-200" 
                              : "bg-gray-100 text-gray-400 border-gray-200"
                          )}
                        >
                          {files[selectedFileForPreview].usePreprocessing ? "Applied" : "Disabled"}
                        </button>
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-[2rem] border border-blue-100 shadow-xl overflow-hidden flex items-center justify-center min-h-[400px] relative">
                      {files[selectedFileForPreview].preprocessedPreview ? (
                        <img 
                          src={files[selectedFileForPreview].preprocessedPreview} 
                          alt="Preprocessed" 
                          className={cn(
                            "max-w-full max-h-[60vh] object-contain rounded-lg shadow-sm transition-all duration-500",
                            !files[selectedFileForPreview].usePreprocessing && "grayscale opacity-30 blur-[2px]"
                          )}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-blue-300">
                          <Loader2 className="w-8 h-8 animate-spin" />
                          <span className="text-xs font-bold uppercase tracking-widest">Processing...</span>
                        </div>
                      )}
                      {!files[selectedFileForPreview].usePreprocessing && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                          <div className="bg-white/90 px-6 py-3 rounded-2xl shadow-2xl border border-gray-100 flex flex-col items-center gap-2">
                            <ZapOff className="w-6 h-6 text-gray-400" />
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Preprocessing Disabled</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-8 p-6 bg-blue-50/50 rounded-3xl border border-blue-100/50">
                  <div className="flex items-start gap-4">
                    <div className="bg-blue-500 p-2 rounded-xl mt-1">
                      <Settings2 className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h5 className="text-sm font-black text-blue-900 uppercase tracking-wider mb-1">Why Preprocess?</h5>
                      <p className="text-xs text-blue-700/80 leading-relaxed font-medium">
                        Advanced preprocessing uses <span className="font-bold">Integral Image Adaptive Thresholding</span> to normalize lighting and enhance text contrast. 
                        This significantly improves OCR accuracy for low-quality scans, shadows, or uneven lighting. Toggle it off if the image is already high-contrast and clean.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-gray-100 bg-white flex justify-end gap-4">
                <button 
                  onClick={() => setSelectedFileForPreview(null)}
                  className="px-8 py-4 rounded-2xl text-sm font-black text-gray-500 hover:bg-gray-50 transition-all uppercase tracking-widest"
                >
                  Close
                </button>
                <button 
                  onClick={() => {
                    setSelectedFileForPreview(null);
                    processFiles();
                  }}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-100 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Process Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                    <div className="bg-blue-100 p-2 rounded-xl">
                      <MessageSquare className="w-5 h-5 text-blue-600" />
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
                        value={feedbackText ?? ""}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Tell us what you think or report an issue..."
                        className="w-full h-40 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmittingFeedback || !feedbackText.trim()}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
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
      
      {/* API Settings Modal */}
      <AnimatePresence>
        {showApiSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiSettings(false)}
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
                    <div className="bg-yellow-100 p-2 rounded-xl">
                      <Key className="w-5 h-5 text-yellow-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">API Key Management</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={undoSettings}
                      disabled={historyPointer <= 0}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Undo Settings Change"
                    >
                      <Undo2 className="w-4 h-4 text-gray-600" />
                    </button>
                    <button 
                      onClick={redoSettings}
                      disabled={historyPointer >= settingsHistory.length - 1}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Redo Settings Change"
                    >
                      <Redo2 className="w-4 h-4 text-gray-600" />
                    </button>
                    <button 
                      onClick={() => setShowApiSettings(false)}
                      className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl">
                    <div className="flex gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-1">Security Note</p>
                        <p className="text-xs text-blue-700 leading-relaxed">
                          API keys are stored locally in your browser. They are never sent to our servers, only directly to the AI providers.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2 ml-1">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Gemini API Key</label>
                        <div className="flex gap-3">
                          <button 
                            onClick={() => window.aistudio?.openSelectKey()}
                            className="text-[10px] font-bold text-blue-600 hover:underline"
                          >
                            Select AI Studio Key
                          </button>
                          <a 
                            href="https://aistudio.google.com/app/apikey" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] font-bold text-blue-600 hover:underline"
                          >
                            Get Key
                          </a>
                        </div>
                      </div>
                      <div className="relative">
                        <input
                          type="password"
                          value={apiKeys.gemini || ''}
                          onChange={(e) => saveApiKeys({ ...apiKeys, gemini: e.target.value })}
                          placeholder="Enter your Gemini API key..."
                          className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          <Lock className="w-4 h-4 text-gray-300" />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 ml-1 italic">
                        If left blank, the system's default key will be used.
                      </p>
                    </div>

                    <div className="pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2 mb-4 ml-1">
                        <TableIcon className="w-4 h-4 text-blue-600" />
                        <h4 className="text-xs font-bold text-gray-900 uppercase tracking-widest">OCR Engine Settings (Tesseract)</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1">Language</label>
                          <select 
                            value={ocrConfig.language}
                            onChange={(e) => saveOcrConfig({ ...ocrConfig, language: e.target.value })}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                          >
                            <option value="eng">English (eng)</option>
                            <option value="fra">French (fra)</option>
                            <option value="deu">German (deu)</option>
                            <option value="spa">Spanish (spa)</option>
                            <option value="ita">Italian (ita)</option>
                            <option value="hin">Hindi (hin)</option>
                            <option value="ara">Arabic (ara)</option>
                            <option value="chi_sim">Chinese Simp. (chi_sim)</option>
                            <option value="jpn">Japanese (jpn)</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1" title="Page Segmentation Mode">PSM Mode</label>
                            <select 
                              value={ocrConfig.psm}
                              onChange={(e) => saveOcrConfig({ ...ocrConfig, psm: e.target.value })}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            >
                              <option value="1">1 - Auto with OSD</option>
                              <option value="3">3 - Fully Auto (Default)</option>
                              <option value="4">4 - Single Column</option>
                              <option value="6">6 - Single Block</option>
                              <option value="11">11 - Sparse Text</option>
                              <option value="12">12 - Sparse with OSD</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1" title="OCR Engine Mode">OEM Mode</label>
                            <select 
                              value={ocrConfig.oem}
                              onChange={(e) => saveOcrConfig({ ...ocrConfig, oem: e.target.value })}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            >
                              <option value="1">1 - Neural Nets (LSTM)</option>
                              <option value="3">3 - Default (Auto)</option>
                            </select>
                          </div>
                        </div>

                        <div className="bg-gray-50/50 border border-gray-100 p-4 rounded-xl space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">WhatsApp Chat Number</label>
                            <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-md border border-green-100">Contact Support</span>
                          </div>
                          <div className="relative">
                            <input 
                              type="text"
                              value={whatsappNumber}
                              onChange={(e) => {
                                const val = e.target.value;
                                setWhatsappNumber(val);
                                localStorage.setItem('invoice_extractor_whatsapp', val);
                              }}
                              placeholder="e.g., 911234567890"
                              className="w-full bg-white border border-gray-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-medium"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <MessageCircle className="w-4 h-4 text-green-500" />
                            </div>
                          </div>
                          <p className="text-[8px] text-gray-400 font-bold leading-tight">
                            Enter the WhatsApp number (with country code, no + or spaces) for the "Chat on WhatsApp" feature.
                          </p>
                        </div>

                        <div className="bg-gray-50/50 border border-gray-100 p-4 rounded-xl">
                          <div className="flex items-center justify-between mb-3">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">PDF Rendering Scale</label>
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">{ocrConfig.pdfScale.toFixed(1)}x</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-[9px] font-bold text-gray-400">1.0x</span>
                            <input 
                              type="range"
                              min="1.0"
                              max="4.0"
                              step="0.5"
                              value={ocrConfig.pdfScale}
                              onChange={(e) => saveOcrConfig({ ...ocrConfig, pdfScale: parseFloat(e.target.value) })}
                              className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <span className="text-[9px] font-bold text-gray-400">4.0x</span>
                          </div>
                          <p className="text-[8px] text-gray-400 font-bold mt-2 leading-tight">
                            Higher scale (e.g., 3.0x) improves accuracy for small text but increases processing time. 2.0x is recommended for most invoices.
                          </p>
                        </div>

                        <div className="pt-2 space-y-4">
                          <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative">
                              <input
                                type="checkbox"
                                checked={ocrConfig.advancedPreprocessing}
                                onChange={(e) => saveOcrConfig({ ...ocrConfig, advancedPreprocessing: e.target.checked })}
                                className="sr-only"
                              />
                              <div className={cn(
                                "w-10 h-5 rounded-full transition-all duration-300 shadow-inner",
                                ocrConfig.advancedPreprocessing ? "bg-blue-500" : "bg-gray-300"
                              )} />
                              <div className={cn(
                                "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-sm",
                                ocrConfig.advancedPreprocessing ? "translate-x-5" : "translate-x-0"
                              )} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-gray-700 uppercase tracking-widest group-hover:text-blue-600 transition-colors">
                                Advanced Image Preprocessing
                              </span>
                              <span className="text-[9px] text-gray-400 font-bold">
                                Deskewing, Binarization & Noise Reduction
                              </span>
                            </div>
                          </label>

                          {ocrConfig.advancedPreprocessing && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="pl-13 space-y-4 border-l-2 border-blue-100 ml-5"
                            >
                              <div className="space-y-4">
                                <label className="flex items-center justify-between cursor-pointer group">
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-gray-700 uppercase tracking-widest group-hover:text-blue-600 transition-colors">
                                      Adaptive Thresholding
                                    </span>
                                    <span className="text-[9px] text-gray-400 font-bold">
                                      Better for uneven lighting & shadows
                                    </span>
                                  </div>
                                  <div className="relative">
                                    <input
                                      type="checkbox"
                                      checked={ocrConfig.adaptiveThreshold}
                                      onChange={(e) => saveOcrConfig({ ...ocrConfig, adaptiveThreshold: e.target.checked })}
                                      className="sr-only"
                                    />
                                    <div className={cn(
                                      "w-8 h-4 rounded-full transition-all duration-300 shadow-inner",
                                      ocrConfig.adaptiveThreshold ? "bg-blue-500" : "bg-gray-300"
                                    )} />
                                    <div className={cn(
                                      "absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm",
                                      ocrConfig.adaptiveThreshold ? "translate-x-4" : "translate-x-0"
                                    )} />
                                  </div>
                                </label>
                                
                                {ocrConfig.adaptiveThreshold && (
                                  <motion.div 
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-1 gap-4 pl-2 pt-1"
                                  >
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <div className="flex flex-col">
                                          <span className="text-[9px] font-bold text-gray-500 uppercase">Block Size</span>
                                          <span className="text-[8px] text-gray-400 font-medium">Local neighborhood area</span>
                                        </div>
                                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{ocrConfig.thresholdBlockSize}px</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="3"
                                        max="51"
                                        step="2"
                                        value={ocrConfig.thresholdBlockSize}
                                        onChange={(e) => saveOcrConfig({ ...ocrConfig, thresholdBlockSize: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <div className="flex flex-col">
                                          <span className="text-[9px] font-bold text-gray-500 uppercase">Constant (C)</span>
                                          <span className="text-[8px] text-gray-400 font-medium">Subtracted from local mean</span>
                                        </div>
                                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{ocrConfig.thresholdC}</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="0"
                                        max="30"
                                        step="1"
                                        value={ocrConfig.thresholdC}
                                        onChange={(e) => saveOcrConfig({ ...ocrConfig, thresholdC: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                      />
                                    </div>
                                  </motion.div>
                                )}
                              </div>

                              <div className="space-y-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={ocrConfig.despeckle}
                                    onChange={(e) => saveOcrConfig({ ...ocrConfig, despeckle: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Despeckle (Noise Reduction)</span>
                                </label>
                                {ocrConfig.despeckle && (
                                  <div className="pl-6 space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[9px] font-bold text-gray-500 uppercase">Filter Radius</span>
                                      <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{ocrConfig.despeckleRadius}px</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="1"
                                      max="3"
                                      step="1"
                                      value={ocrConfig.despeckleRadius}
                                      onChange={(e) => saveOcrConfig({ ...ocrConfig, despeckleRadius: parseInt(e.target.value) })}
                                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="space-y-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={ocrConfig.removeLines}
                                    onChange={(e) => saveOcrConfig({ ...ocrConfig, removeLines: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Remove Lines & Grids</span>
                                </label>
                                {ocrConfig.removeLines && (
                                  <div className="pl-6 space-y-3">
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[9px] font-bold text-gray-500 uppercase">Min Line Length</span>
                                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{ocrConfig.lineRemovalLength}px</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="10"
                                        max="200"
                                        step="10"
                                        value={ocrConfig.lineRemovalLength}
                                        onChange={(e) => saveOcrConfig({ ...ocrConfig, lineRemovalLength: parseInt(e.target.value) })}
                                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[9px] font-bold text-gray-500 uppercase">Max Thickness</span>
                                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{ocrConfig.lineRemovalThickness}px</span>
                                      </div>
                                      <input 
                                        type="range"
                                        min="1"
                                        max="5"
                                        step="1"
                                        value={ocrConfig.lineRemovalThickness}
                                        onChange={(e) => saveOcrConfig({ ...ocrConfig, lineRemovalThickness: parseInt(e.target.value) })}
                                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </div>
                      </div>
                      <p className="text-[9px] text-gray-400 mt-3 ml-1 leading-relaxed">
                        Adjust these settings if the AI struggles to read specific document layouts or languages.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowApiSettings(false)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                  >
                    <Save className="w-5 h-5" />
                    Save & Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img 
              src="https://cdn3d.iconscout.com/3d/premium/thumb/invoice-6332629-5220370.png" 
              alt="3D Invoice" 
              className="h-10 w-10 object-contain drop-shadow-md"
              referrerPolicy="no-referrer"
            />
            <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-gray-900 truncate max-w-[120px] sm:max-w-none">SmartInvoice</h1>
                <span className="bg-blue-100 text-blue-700 text-[9px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter shrink-0">v0.1.0</span>
              </div>
              <p className="text-[10px] text-gray-400 font-bold -mt-1 uppercase tracking-widest hidden xs:block">Powered by Gemini AI</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[9px] text-blue-500/60 font-black uppercase tracking-[0.2em] hidden md:block">Developed by Dinesh JAISWAL</p>
                <a 
                  href={`https://wa.me/${whatsappNumber}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full transition-all shadow-sm"
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
            <div className="flex items-center gap-2 sm:gap-4 lg:gap-6">
              {isProcessing && (
                <div className="hidden xl:flex flex-col items-end w-48 mr-4">
                <div className="flex justify-between w-full mb-1">
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Processing</span>
                  <span className="text-[10px] font-black text-blue-600">{Math.round(finalProgress)}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${finalProgress}%` }}
                    className="h-full bg-blue-600 rounded-full"
                  />
                </div>
              </div>
            )}
            <div className="hidden lg:flex flex-col items-end text-right mr-2">
              <div className={cn(
                "flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm overflow-hidden max-w-[300px] transition-colors",
                isOnline ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
              )}>
                <span className="relative flex h-2 w-2 flex-shrink-0">
                  {isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                  <span className={cn(
                    "relative inline-flex rounded-full h-2 w-2 transition-colors",
                    isOnline ? "bg-green-500" : "bg-gray-400"
                  )}></span>
                </span>
                <div className="flex items-center gap-1 overflow-hidden">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-widest flex-shrink-0 transition-colors",
                    isOnline ? "text-green-700" : "text-gray-500"
                  )}>
                    {isOnline ? "Online:" : "Offline:"}
                  </span>
                  <div className="flex items-center gap-1 overflow-hidden">
                    <span className={cn(
                      "text-[10px] font-bold truncate transition-colors",
                      isOnline ? "text-green-700" : "text-gray-500"
                    )}>
                      {activeUsers.filter(u => u.status === 'online').length > 0 
                        ? activeUsers.filter(u => u.status === 'online').map(u => u.name).join(', ') 
                        : user?.name}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-[9px] text-gray-400 font-bold flex items-center gap-1.5 mt-1 uppercase tracking-tighter">
                {isOnline ? "System Online" : "System Offline"} • {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center text-white font-bold shadow-md border-2 border-white">
                  {user?.name.charAt(0).toUpperCase()}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white shadow-sm ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`}></div>
              </div>
              {user?.role === 'admin' && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase shadow-sm">Admin</span>
              )}
            </div>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
            <button 
              onClick={() => setShowApiSettings(true)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium p-1.5 sm:p-0"
              title="API Settings"
            >
              <Key className="w-4 h-4" />
              <span className="hidden xl:inline">API Settings</span>
            </button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
            <button 
              onClick={() => setShowFeedbackModal(true)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium p-1.5 sm:p-0"
              title="Send Feedback"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden xl:inline">Feedback</span>
            </button>
            <div className="h-6 w-px bg-gray-200 hidden md:block"></div>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-red-500 transition-colors font-medium hidden md:block">Clear All</button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium p-1 sm:p-0"
              title="Logout"
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
              className="mb-8 bg-white p-6 rounded-2xl shadow-sm border border-blue-100 overflow-hidden relative"
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
              
              <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${finalProgress}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                  className="h-full bg-blue-600 rounded-full shadow-[0_0_15px_rgba(37,99,235,0.5)] relative overflow-hidden"
                >
                  <motion.div 
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            {/* Active Users List */}
            <section className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 three-d-shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-bold flex items-center gap-2 text-gray-900">
                  <Users className="w-5 h-5 text-green-500" />
                  Active Users
                </h2>
                <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {activeUsers.filter(u => u.status === 'online').length} Online
                </span>
              </div>
              <div className="flex sm:flex-col gap-3 overflow-x-auto sm:overflow-y-auto pb-2 sm:pb-0 pr-2 custom-scrollbar snap-x">
                {activeUsers.filter(u => u.status === 'online').map((u) => (
                  <motion.div 
                    key={u.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-green-200 transition-colors group min-w-[180px] sm:min-w-0 snap-start"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs border border-blue-200">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${u.status === 'online' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                      </div>
                      <div className="truncate">
                        <p className="text-sm font-bold text-gray-900 group-hover:text-green-600 transition-colors truncate">{u.name}</p>
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">
                          {u.status === 'online' ? 'Active Now' : 'Away'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {u.name === user?.name && (
                        <span className="text-[8px] font-black bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0">You</span>
                      )}
                      {user?.role === 'admin' && u.name !== user?.name && (
                        <button 
                          onClick={() => kickUser(u.id)}
                          className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                          title="Kick User"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
                {activeUsers.filter(u => u.status === 'online').length === 0 && (
                  <div className="text-center py-6 w-full">
                    <p className="text-xs text-gray-400 font-medium italic">No other users online</p>
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 three-d-shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                  <Upload className="w-5 h-5 text-blue-500" />
                  Upload Invoices
                </h2>
                <div className="flex items-center gap-3">
                  {files.some(f => f.status === 'error') && (
                    <button 
                      onClick={() => setFiles(prev => prev.filter(f => f.status !== 'error'))}
                      className="text-[10px] font-black text-red-500 hover:text-red-600 uppercase tracking-widest flex items-center gap-1 transition-colors"
                      title="Remove all failed files"
                    >
                      <Trash2 className="w-3 h-3" /> Clear Errors
                    </button>
                  )}
                  {files.length > 0 && (
                    <button 
                      onClick={() => {
                        if (confirm("Are you sure you want to clear all files?")) {
                          setFiles([]);
                        }
                      }}
                      className="text-[10px] font-black text-gray-400 hover:text-gray-600 uppercase tracking-widest flex items-center gap-1 transition-colors"
                      title="Remove all files"
                    >
                      <X className="w-3 h-3" /> Clear All
                    </button>
                  )}
                </div>
              </div>
              
              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-xl p-4 sm:p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2 sm:gap-4 mb-4",
                  isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-400 hover:bg-gray-50"
                )}
              >
                <input {...getInputProps()} />
                <div className="bg-blue-100 p-3 sm:p-4 rounded-full shadow-inner">
                  <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-sm sm:text-base text-gray-900">Drop PDFs, Images or Folders here</p>
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-1 uppercase tracking-wider font-medium">AI will process scans and blurry photos</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4 mt-6 mb-2">
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
                <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Filter className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Filters</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</label>
                      <select 
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="completed">Completed</option>
                        <option value="error">Error</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Date Processed</label>
                      <input 
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Page Count</label>
                      <input 
                        type="number"
                        placeholder="Filter by pages..."
                        value={pageCountFilter === null ? '' : pageCountFilter}
                        onChange={(e) => setPageCountFilter(e.target.value === '' ? null : parseInt(e.target.value))}
                        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    {(statusFilter !== 'all' || dateFilter || pageCountFilter !== null) && (
                      <button 
                        onClick={() => {
                          setStatusFilter('all');
                          setDateFilter('');
                          setPageCountFilter(null);
                        }}
                        className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest mt-1 text-left"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </div>
              )}

              {filteredFiles.length > 0 && (
                <div className="space-y-3 mb-6 max-h-60 overflow-auto pr-2">
                  <AnimatePresence>
                    {filteredFiles.map((f, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ 
                          opacity: 1, 
                          x: 0,
                          backgroundColor: f.status === 'processing' ? 'rgba(239, 246, 255, 0.5)' : '#ffffff'
                        }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={cn(
                          "flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm transition-colors",
                          f.status === 'processing' && "border-blue-200 ring-1 ring-blue-100"
                        )}
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
                                {f.statusText && (
                                  <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest animate-pulse whitespace-nowrap">
                                    {f.statusText}
                                  </span>
                                )}
                                {f.pageCount && (
                                  <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-black whitespace-nowrap">
                                    {f.pageCount} {f.pageCount === 1 ? 'Page' : 'Pages'}
                                  </span>
                                )}
                              </div>
                              {f.status === 'processing' && (
                                <div className="flex flex-col gap-1 mt-1">
                                  <div className="flex justify-between items-center">
                                    <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mr-2">
                                      <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${f.progress || 0}%` }}
                                        className="h-full bg-blue-500 rounded-full"
                                      />
                                    </div>
                                    <span className="text-[9px] font-black text-blue-600 tabular-nums">
                                      {Math.round(f.progress || 0)}%
                                    </span>
                                  </div>
                                </div>
                              )}
                                {f.error && (
                                  <div className="flex flex-col gap-2 mt-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100 shadow-sm">
                                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span className="text-[11px] font-bold">Extraction Failed</span>
                                      </div>
                                      
                                      <div className="flex items-center gap-1.5">
                                        <button 
                                          onClick={() => toggleErrorExpansion(idx)}
                                          className="text-[10px] text-red-600 font-bold hover:bg-red-50 px-2 py-1 rounded-md border border-red-200 transition-colors flex items-center gap-1"
                                        >
                                          {expandedErrors.has(idx) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                          {expandedErrors.has(idx) ? 'Hide Details' : 'View Details'}
                                        </button>
                                        
                                        {!isProcessing && (
                                          <button 
                                            onClick={() => retryFile(idx)}
                                            className="text-[10px] text-blue-600 font-bold hover:bg-blue-50 px-2 py-1 rounded-md border border-blue-200 flex items-center gap-1 transition-colors shadow-sm"
                                          >
                                            <RefreshCw className="w-2.5 h-2.5" />
                                            Retry
                                          </button>
                                        )}
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(f.error || "");
                                            toast.success("Error details copied");
                                          }}
                                          className="text-[10px] text-gray-500 font-bold hover:text-gray-700 bg-gray-50 px-2 py-1 rounded-md border border-gray-100 flex items-center gap-1 transition-colors"
                                          title="Copy full error message"
                                        >
                                          <Copy className="w-2.5 h-2.5" />
                                        </button>
                                      </div>
                                    </div>

                                    <AnimatePresence>
                                      {expandedErrors.has(idx) && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="overflow-hidden"
                                        >
                                          <div className="bg-red-50/50 border border-red-100 rounded-lg p-3 text-[11px] text-red-700 font-medium leading-relaxed">
                                            <p className="mb-2">{f.error}</p>
                                            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-red-100/50">
                                              <a 
                                                href="https://ai.google.dev/gemini-api/docs/troubleshooting" 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-[10px] text-blue-600 hover:text-blue-800 underline flex items-center gap-1 font-bold"
                                              >
                                                Troubleshooting Guide
                                              </a>
                                            </div>
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )}
                                {f.rawText && (
                                  <button 
                                    onClick={() => setSelectedFileForOCR(idx)}
                                    className="mt-2 text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 w-fit transition-all"
                                  >
                                    <FileText className="w-3 h-3" /> View OCR Raw Text
                                  </button>
                                )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleFilePreprocessing(idx)}
                              className={cn(
                                "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border transition-all flex items-center gap-1",
                                f.usePreprocessing 
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                                  : "bg-gray-50 text-gray-400 border-gray-200 opacity-60"
                              )}
                              title="Toggle OCR Preprocessing"
                            >
                              {f.usePreprocessing ? <Zap className="w-2.5 h-2.5" /> : <ZapOff className="w-2.5 h-2.5" />}
                              {f.usePreprocessing ? "Pre-proc ON" : "Pre-proc OFF"}
                            </button>

                            <button
                              onClick={() => generateFilePreviews(idx)}
                              disabled={isGeneratingPreview}
                              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all flex items-center gap-1 disabled:opacity-50"
                              title="Preview Preprocessing Impact"
                            >
                              {isGeneratingPreview && selectedFileForPreview === null ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Eye className="w-2.5 h-2.5" />}
                              Preview
                            </button>

                            <button 
                              onClick={() => setEditingFileIndex(editingFileIndex === idx ? null : idx)}
                              className={cn(
                                "p-1 rounded-full transition-colors",
                                f.customInstructions ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:bg-gray-200"
                              )}
                              title="Edit file instructions"
                            >
                              <Settings2 className="w-3 h-3" />
                            </button>
                            {f.status === 'processing' && (
                              <button 
                                onClick={() => {
                                  setFiles(prev => prev.map((file, i) => i === idx ? { ...file, status: 'error', error: 'Cancelled' } : file));
                                }}
                                className="p-1 hover:bg-red-100 rounded-full text-red-500 transition-colors"
                                title="Cancel processing"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                            {f.status === 'completed' && !isProcessing && (
                              <button 
                                onClick={() => reprocessFile(idx)}
                                className="p-1 hover:bg-blue-100 rounded-full text-blue-500 transition-colors"
                                title="Reprocess with new instructions"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            )}
                            {f.status === 'error' && !isProcessing && (
                              <button 
                                onClick={() => retryFile(idx)}
                                className="p-1 hover:bg-red-100 rounded-full text-red-500 transition-colors"
                                title="Continue"
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
                                className="w-full h-20 bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all resize-none"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {files.length > 0 && filteredFiles.length === 0 && (
                <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 mb-6">
                  <Filter className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 font-medium">No files match the selected filters</p>
                  <button 
                    onClick={() => {
                      setStatusFilter('all');
                      setDateFilter('');
                      setPageCountFilter(null);
                    }}
                    className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest mt-2"
                  >
                    Reset Filters
                  </button>
                </div>
              )}

                <div className="grid grid-cols-2 gap-3 mt-4">
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

                {data.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => exportToExcel()}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-emerald-100 three-d-button"
                  >
                    <FileSpreadsheet className="w-6 h-6" />
                    Download Excel Report
                  </motion.button>
                )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
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
                          value={col.label ?? ""}
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
              <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between bg-white/50 sticky top-0 z-10 gap-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Consolidated Data</h2>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    {data.length} items extracted 
                    {totalPagesProcessed > 0 && ` • ${totalPagesProcessed} Pages Read`}
                    • Excel-Style Editing Active
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
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
                  <div className="relative group flex-1 sm:flex-none min-w-[150px]">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      type="text"
                      value={searchTerm ?? ""}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search..."
                      className={cn(
                        "pl-10 pr-10 py-2 bg-white border rounded-lg text-xs font-medium focus:outline-none focus:ring-2 transition-all w-full sm:w-48 md:w-64",
                        searchTerm ? "border-blue-500 ring-2 ring-blue-500/10" : "border-gray-200 focus:ring-blue-500/20 focus:border-blue-500"
                      )}
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {(statusFilter !== 'all' || dateFilter || pageCountFilter !== null) && (
                    <button 
                      onClick={() => {
                        setStatusFilter('all');
                        setDateFilter('');
                        setPageCountFilter(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-200 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-all shadow-sm"
                    >
                      <Filter className="w-3 h-3" />
                      <span className="hidden sm:inline">Active Filters</span>
                      <X className="w-2.5 h-2.5 ml-1" />
                    </button>
                  )}
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
                        onClick={addRow}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 p-2 rounded-lg transition-all border border-blue-200 shadow-sm"
                        title="Add New Row"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                      
                      {/* Desktop Export Buttons */}
                      <div className="hidden xl:flex items-center gap-2">
                        <button
                          onClick={captureTable}
                          disabled={isCapturing}
                          className="bg-slate-700 hover:bg-slate-800 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-slate-100 three-d-button"
                          title="Capture Table Screenshot (PNG)"
                        >
                          {isCapturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                          Capture
                        </button>
                        <button
                          onClick={exportAllFormats}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-100 three-d-button"
                          title="Export all data in all formats (ZIP bundle)"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Bundle
                        </button>
                        <button
                          onClick={exportToCSV}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-blue-100 three-d-button"
                          title="Export all data columns to CSV"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          CSV
                        </button>
                        <button
                          onClick={() => exportToExcel()}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-100 three-d-button"
                          title="Export visible columns to Excel"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Excel
                        </button>
                        <button
                          onClick={exportToJSON}
                          className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-amber-100 three-d-button"
                          title="Export all data to JSON"
                        >
                          <FileJson className="w-3.5 h-3.5" />
                          JSON
                        </button>
                        <button
                          onClick={() => setShowEmailModal(true)}
                          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-purple-100 three-d-button"
                          title="Export all data via Email"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Email
                        </button>
                        <button
                          onClick={() => {
                            const text = encodeURIComponent(`Invoice Data Export from SmartInvoice Extractor: ${data.length} items extracted.`);
                            window.open(`https://wa.me/${whatsappNumber}?text=${text}`, '_blank');
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-green-100 three-d-button"
                          title="Share summary via WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          WhatsApp
                        </button>
                      </div>

                      {/* Mobile/Tablet Export Dropdown */}
                      <div className="xl:hidden relative">
                        <button
                          onClick={() => setShowExportMenu(!showExportMenu)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-blue-100"
                        >
                          <Download className="w-4 h-4" />
                          Export
                          <ChevronDown className={cn("w-3 h-3 transition-transform", showExportMenu && "rotate-180")} />
                        </button>
                        
                        <AnimatePresence>
                          {showExportMenu && (
                            <>
                              <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setShowExportMenu(false)}
                              />
                              <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 py-2 overflow-hidden"
                              >
                                <button
                                  onClick={() => { exportAllFormats(); setShowExportMenu(false); }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-3 transition-colors"
                                >
                                  <Archive className="w-4 h-4" /> Bundle (ZIP)
                                </button>
                                <button
                                  onClick={() => { exportToCSV(); setShowExportMenu(false); }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-3 transition-colors"
                                >
                                  <FileSpreadsheet className="w-4 h-4" /> CSV Format
                                </button>
                                <button
                                  onClick={() => { exportToExcel(); setShowExportMenu(false); }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 flex items-center gap-3 transition-colors"
                                >
                                  <Download className="w-4 h-4" /> Excel Sheet
                                </button>
                                <button
                                  onClick={() => { exportToJSON(); setShowExportMenu(false); }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-3 transition-colors"
                                >
                                  <FileJson className="w-4 h-4" /> JSON Data
                                </button>
                                <div className="h-px bg-gray-100 my-1" />
                                <button
                                  onClick={() => { setShowEmailModal(true); setShowExportMenu(false); }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-purple-50 hover:text-purple-600 flex items-center gap-3 transition-colors"
                                >
                                  <Mail className="w-4 h-4" /> Send via Email
                                </button>
                                <button
                                  onClick={() => {
                                    const text = encodeURIComponent(`Invoice Data Export from SmartInvoice Extractor: ${data.length} items extracted.`);
                                    window.open(`https://wa.me/${whatsappNumber}?text=${text}`, '_blank');
                                    setShowExportMenu(false);
                                  }}
                                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-gray-700 hover:bg-green-50 hover:text-green-600 flex items-center gap-3 transition-colors"
                                >
                                  <MessageCircle className="w-4 h-4" /> Share via WhatsApp
                                </button>
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>

                      <button
                        onClick={clearAllData}
                        className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-lg transition-all border border-red-200 shadow-sm"
                        title="Clear All History & Data"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
                          {/* Smart Refine Bar */}
              {data.length > 0 && (
                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-blue-50/50 border-b border-blue-100 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-200 shrink-0">
                      <RefreshCw className={cn("w-4 h-4 text-white", isRefining && "animate-spin")} />
                    </div>
                    <div className="sm:hidden flex flex-col">
                      <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Smart Assistant</span>
                      <span className="text-[8px] text-blue-400 font-bold">Gemini 3.1</span>
                    </div>
                  </div>
                  <div className="flex-1 relative w-full">
                    <input 
                      type="text"
                      value={refinePrompt ?? ""}
                      onChange={(e) => setRefinePrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                      placeholder="Ask AI to update table..."
                      className="w-full bg-white border border-blue-200 rounded-xl py-2.5 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm font-medium"
                      disabled={isRefining}
                    />
                    <button 
                      onClick={handleRefine}
                      disabled={isRefining || !refinePrompt.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-all"
                    >
                      {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="hidden sm:flex flex-col shrink-0">
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Smart Assistant</span>
                    <span className="text-[8px] text-blue-400 font-bold">Powered by Gemini 3.1</span>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto" id="invoice-data-table">
                {data.length > 0 ? (
                  <table className="min-w-[1000px] w-full text-left border-collapse table-auto">
                    <thead className="bg-gray-50/80 sticky top-0 z-10">
                      <tr>
                        {columns.filter(c => c.enabled).map((col, index) => (
                          <th 
                            key={col.key} 
                            draggable
                            onDragStart={() => handleColumnDragStart(columns.indexOf(col))}
                            onDragOver={(e) => handleColumnDragOver(e, index)}
                            onDrop={() => handleColumnDrop(columns.indexOf(col))}
                            className={cn(
                              "px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-200 truncate cursor-move hover:bg-gray-100 transition-colors",
                              draggedColumnIndex === columns.indexOf(col) ? "opacity-30" : ""
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <GripVertical className="w-3 h-3 opacity-30" />
                              {col.label}
                            </div>
                          </th>
                        ))}
                        <th className="w-12 border-b border-gray-200"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paginatedData.map((item, index) => {
                        const rowIndex = startIndex + index;
                        return (
                          <tr key={rowIndex} className="group hover:bg-blue-50/30 transition-colors">
                            {columns.filter(c => c.enabled).map(col => {
                              const cellValue = String(item[col.key] ?? "");
                              const isMatch = searchTerm && cellValue.toLowerCase().includes(searchTerm.toLowerCase());
                              
                              return (
                                <td 
                                  key={col.key} 
                                  className={cn(
                                    "p-0 border-r border-gray-100 last:border-r-0 relative transition-colors duration-200",
                                    isMatch ? "bg-yellow-50/60" : "bg-transparent"
                                  )}
                                >
                                  <div className="relative w-full h-full">
                                    <input 
                                      type={typeof item[col.key] === 'number' ? 'number' : 'text'}
                                      value={item[col.key] ?? ""}
                                      onChange={(e) => handleCellEdit(rowIndex, col.key, e.target.value)}
                                      onFocus={() => setFocusedCell({ rowIndex, colKey: col.key })}
                                      onBlur={() => setFocusedCell(null)}
                                      className={cn(
                                        "w-full h-full bg-transparent border-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white px-4 py-4 text-sm text-gray-700 font-medium transition-all outline-none",
                                        searchTerm && (focusedCell?.rowIndex !== rowIndex || focusedCell?.colKey !== col.key) ? "text-transparent" : ""
                                      )}
                                    />
                                    {searchTerm && (focusedCell?.rowIndex !== rowIndex || focusedCell?.colKey !== col.key) && (
                                      <div className="absolute inset-0 pointer-events-none px-4 py-4 text-sm text-gray-700 font-medium flex items-center truncate">
                                        <Highlight text={cellValue} highlight={searchTerm} />
                                      </div>
                                    )}
                                  </div>
                                  <div className={cn(
                                    "absolute inset-0 pointer-events-none border transition-all",
                                    isMatch ? "border-yellow-200/50" : "border-blue-500/0 group-hover:border-blue-500/10"
                                  )} />
                                </td>
                              );
                            })}
                            <td className="p-0 text-center">
                              <button 
                                onClick={() => deleteRow(rowIndex)}
                                className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                title="Delete Row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
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
                <div className="p-3 sm:p-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between bg-gray-50/50 gap-3">
                  <div className="text-[10px] sm:text-xs text-gray-500 font-medium">
                    Showing <span className="text-gray-900">{startIndex + 1}</span> to <span className="text-gray-900">{Math.min(startIndex + rowsPerPage, filteredData.length)}</span> of <span className="text-gray-900">{filteredData.length}</span> items
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
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
          <p>© {new Date().getFullYear()} SmartInvoice Extractor</p>
          <div className="flex items-center gap-2 font-medium">
            <span>Developed by Dinesh JAISWAL</span>
            <a 
              href={`https://wa.me/${whatsappNumber}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-green-600 hover:text-green-700 transition-colors"
            >
              <MessageCircle className="w-3 h-3" />
              Chat on WhatsApp
            </a>
          </div>
        </div>
      </footer>
      </div>
    </div>
    </>
  );
}
