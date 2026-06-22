import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader,
  ArrowLeft,
  ShieldCheck,
  EyeOff,
  Layers,
  Lock,
  Search,
  Info,
  ChevronRight,
  ChevronLeft,
  FileSearch,
  Trash2,
  XCircle
} from 'lucide-react';
import Markdown from 'markdown-to-jsx';

// Server Gateway Endpoint
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API_URL = `${BASE_URL}/api/documents`;

interface DocumentSummary {
  id: string;
  filename: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  contractType: string | null;
  riskLevel: string | null;
  selectedModel: string | null;
  progressStep: string;
  progressPercent: number;
  createdAt: string;
}

interface PiiMapping {
  placeholder: string;
  original: string;
  type: string;
}

interface IdentifiedRisk {
  target: string;
  clause: string;
  risk_description: string;
  page: number;
}

interface DocumentDetail {
  id: string;
  filename: string;
  originalText: string;
  scrubbedText: string;
  piiMapping: PiiMapping[];
  status: string;
  contractType: string | null;
  riskLevel: string | null;
  selectedModel: string | null;
  progressStep: string;
  progressPercent: number;
  createdAt: string;
}

interface AuditResults {
  id: string;
  jobId: string;
  executiveSummary: string;
  identifiedRisks: IdentifiedRisk[];
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('harvey_jwt'));
  const [user, setUser] = useState<{ id: string; username: string } | null>(
    localStorage.getItem('harvey_user') ? JSON.parse(localStorage.getItem('harvey_user')!) : null
  );

  // Authentication views state
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authGroqKey, setAuthGroqKey] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<DocumentDetail | null>(null);
  const [auditResults, setAuditResults] = useState<AuditResults | null>(null);
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Detail workspace settings
  const [viewMode, setViewMode] = useState<'original' | 'scrubbed'>('scrubbed');
  const [activeTab, setActiveTab] = useState<'summary' | 'risks' | 'scrubber'>('summary');
  const [hoveredPii, setHoveredPii] = useState<{ placeholder: string; original: string } | null>(null);
  const [activeRiskIndex, setActiveRiskIndex] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterRisksByPage, setFilterRisksByPage] = useState(true);
  const [filterPiiByPage, setFilterPiiByPage] = useState(true);

  // Helper to split text into pages matching backend logic
  const getPages = (text: string) => {
    if (!text) return [''];
    const rawPages = text.split(/\f/);
    if (rawPages.length > 1) {
      const pages = rawPages.map(p => p.trim());
      if (pages.length > 0 && pages[pages.length - 1] === '') {
        pages.pop();
      }
      return pages.length > 0 ? pages : [''];
    }
    const pageSize = 3000;
    const pages: string[] = [];
    let currentPos = 0;
    while (currentPos < text.length) {
      pages.push(text.substring(currentPos, currentPos + pageSize));
      currentPos += pageSize;
    }
    return pages.length > 0 ? pages : [''];
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    const isLogin = authMode === 'login';
    const authEndpoint = authMode === 'login' 
      ? `${BASE_URL}/api/auth/login` 
      : `${BASE_URL}/api/auth/signup`;

    const payload = isLogin
      ? { username: authUsername, password: authPassword }
      : { username: authUsername, password: authPassword, groqApiKey: authGroqKey };

    try {
      const res = await fetch(authEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (isLogin) {
        localStorage.setItem('harvey_jwt', data.token);
        localStorage.setItem('harvey_user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        setAuthUsername('');
        setAuthPassword('');
      } else {
        setAuthSuccess(data.message || 'Signup successful! You can now log in.');
        setAuthMode('login');
        setAuthPassword('');
        setAuthGroqKey('');
      }
    } catch (err: any) {
      setAuthError(err.message || 'An error occurred.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('harvey_jwt');
    localStorage.removeItem('harvey_user');
    setToken(null);
    setUser(null);
    setDocuments([]);
    setSelectedDocId(null);
  };

  // Fetch all documents on load
  const fetchDocuments = async () => {
    if (!token) return;
    try {
      const res = await fetch(API_URL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchDocuments();
      // Only poll if there are processing/uploaded documents
      const hasProcessing = documents.some(d => d.status === 'processing' || d.status === 'uploaded');
      if (hasProcessing) {
        const interval = setInterval(fetchDocuments, 5000);
        return () => clearInterval(interval);
      }
    }
  }, [token, documents.some(d => d.status === 'processing' || d.status === 'uploaded')]);

  // Fetch document details when selected
  const fetchDetail = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDetailDoc(data.document);

        // Deduplicate risks: LLMs sometimes output the exact same risk multiple times
        if (data.auditResults && data.auditResults.identifiedRisks) {
          const uniqueRisks: typeof data.auditResults.identifiedRisks = [];
          const seen = new Set();
          for (const risk of data.auditResults.identifiedRisks) {
            // Filter out empty or hallucinated clauses from the LLM
            if (!risk.clause || risk.clause.trim().length < 5) continue;
            
            const key = `${risk.target}|${risk.clause}|${risk.page}`;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueRisks.push(risk);
            }
          }
          data.auditResults.identifiedRisks = uniqueRisks;
        }
        
        setAuditResults(data.auditResults);
        
        // Auto select tab if complete
        if (data.document.status === 'completed' && data.auditResults) {
          setActiveTab('summary');
        } else {
          setActiveTab('scrubber');
        }
      }
    } catch (err) {
      console.error('Error fetching document details:', err);
    }
  };

  useEffect(() => {
    if (selectedDocId) {
      fetchDetail(selectedDocId);
      setCurrentPage(1); // Reset page on selection
    } else {
      setDetailDoc(null);
      setAuditResults(null);
    }
  }, [selectedDocId]);

  // Poll detail only while the selected document is still processing
  useEffect(() => {
    if (!selectedDocId || !detailDoc) return;
    if (detailDoc.status !== 'processing' && detailDoc.status !== 'uploaded') return;

    const detailInterval = setInterval(() => {
      fetchDetail(selectedDocId);
    }, 4000);
    return () => clearInterval(detailInterval);
  }, [selectedDocId, detailDoc?.status]);

  // Cancel or Delete Document Handler
  const handleDeleteOrCancel = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const confirmMsg = "Are you sure you want to cancel/delete this contract audit?";
    if (!window.confirm(confirmMsg)) {
      return;
    }
    try {
      const res = await fetch(`${API_URL}/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (selectedDocId === id) {
          setSelectedDocId(null);
        }
        fetchDocuments();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to cancel/delete document');
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('An error occurred while deleting the document.');
    }
  };

  // File Upload Handlers
  const handleUpload = async (file: File) => {
    if (!token) return;
    setIsUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append('contract', file);

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Upload failed');
      }
      const data = await res.json();
      setSelectedDocId(data.document_id);
      fetchDocuments();
    } catch (err: any) {
      setUploadError(err.message || 'An error occurred during file upload.');
    } finally {
      setIsUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  const triggerSelectFile = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  // Helper: Highlight PII and Risks in document text
  const renderDocumentText = () => {
    if (!detailDoc) return null;

    // Normalize text that has character-level spacing from PDF extraction
    // Detects patterns like "P A R T  I" and collapses them to "PART I"
    const normalizeSpacedText = (input: string): string => {
      if (!input || input.length < 10) return input;
      // Check if text appears to have character-level spacing:
      // If more than 35% of whitespace-split tokens are single alphanumeric characters
      const tokens = input.split(/\s+/).filter(w => w.length > 0);
      if (tokens.length < 5) return input;
      const singleCharCount = tokens.filter(w => w.length === 1 && /[A-Za-z0-9]/.test(w)).length;
      if (singleCharCount / tokens.length < 0.3) return input;

      // Collapse: "P A R T" → "PART" (single alpha char + single space + single alpha char)
      // Then collapse leftover double+ spaces → single space
      return input
        .split('\n')
        .map(line => {
          let prev = line;
          // Iteratively collapse until stable (handles adjacent single-char groups)
          for (let i = 0; i < 5; i++) {
            const next = prev.replace(/([A-Za-z0-9]) (?=[A-Za-z0-9])/g, '$1');
            if (next === prev) break;
            prev = next;
          }
          return prev.replace(/ {2,}/g, ' ').trim();
        })
        .join('\n');
    };

    // Use scrubbed text as base to align page boundaries and coordinates exactly
    let fullText = detailDoc.scrubbedText;
    const pages = getPages(fullText);
    const pageIndex = Math.min(Math.max(currentPage - 1, 0), pages.length - 1);
    let text = normalizeSpacedText(pages[pageIndex] || '');

    const getDisplayText = (val: string) => {
      if (viewMode === 'scrubbed') return val;
      let result = val;
      detailDoc.piiMapping.forEach(mapping => {
        const normalizedOriginal = normalizeSpacedText(mapping.original);
        result = result.split(mapping.placeholder).join(normalizedOriginal);
      });
      return result;
    };

    if (!text.trim()) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '200px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          [Empty Page]
        </div>
      );
    }
    
    // Filter risks to only show the ones identified on this page
    const pageRisks = [...(auditResults?.identifiedRisks || [])]
      .filter(risk => risk.page === pageIndex + 1);

    const allRisks = auditResults?.identifiedRisks || [];

    // Let's create an array of segments representing the text
    // We will find all PII placeholders/original values and Risk clauses,
    // and split the text into chunks: { text, type: 'plain' | 'pii' | 'risk', payload }
    interface TextSegment {
      text: string;
      type: 'plain' | 'pii' | 'risk';
      riskIndex?: number;
      piiType?: string;
      originalVal?: string;
      placeholderVal?: string;
    }

    let segments: TextSegment[] = [{ text, type: 'plain' }];

    // 1. First, split by Risks (if any exist on this page) so they take priority
    if (detailDoc.status === 'completed' && pageRisks.length > 0) {
      pageRisks.forEach((risk) => {
        // Find index of this risk in the original complete list to preserve active highlight
        const originalIdx = auditResults?.identifiedRisks.findIndex(
          r => r.clause === risk.clause && r.page === risk.page
        ) ?? -1;

        const newSegments: TextSegment[] = [];
        segments.forEach(seg => {
          if (seg.type !== 'plain') {
            newSegments.push(seg);
            return;
          }

          // Normalize the risk clause the same way we normalized the page text
          let clauseToFind = normalizeSpacedText(risk.clause);
          // Skip empty or very short clauses to prevent character-level matching
          if (!clauseToFind || clauseToFind.length < 10) {
            newSegments.push(seg);
            return;
          }
          
          const parts = seg.text.split(clauseToFind);
          if (parts.length > 1) {
            parts.forEach((part, index) => {
              if (part) newSegments.push({ text: part, type: 'plain' });
              if (index < parts.length - 1) {
                newSegments.push({
                  text: clauseToFind,
                  type: 'risk',
                  riskIndex: originalIdx
                });
              }
            });
          } else {
            newSegments.push(seg);
          }
        });
        segments = newSegments;
      });
    }

    // 2. Next, split by PII mappings within the plain text segments
    detailDoc.piiMapping.forEach(mapping => {
      const newSegments: TextSegment[] = [];
      const termToFind = mapping.placeholder;
      
      segments.forEach(seg => {
        if (seg.type !== 'plain') {
          newSegments.push(seg);
          return;
        }

        const parts = seg.text.split(termToFind);
        if (parts.length > 1) {
          parts.forEach((part, index) => {
            if (part) newSegments.push({ text: part, type: 'plain' });
            if (index < parts.length - 1) {
              newSegments.push({
                text: termToFind,
                type: 'pii',
                piiType: mapping.type,
                originalVal: mapping.original,
                placeholderVal: mapping.placeholder
              });
            }
          });
        } else {
          newSegments.push(seg);
        }
      });
      segments = newSegments;
    });

    // 3. Map segments to React nodes
    return (
      <div style={{ whiteSpace: 'pre-line', lineHeight: '1.75', fontSize: '0.975rem' }}>
        {segments.map((seg, idx) => {
          if (seg.type === 'pii') {
            const isHovered = hoveredPii?.placeholder === seg.placeholderVal;
            return (
              <span
                key={idx}
                className="highlight-pii"
                onMouseEnter={() =>
                  setHoveredPii({
                    placeholder: seg.placeholderVal || '',
                    original: seg.originalVal || '',
                  })
                }
                onMouseLeave={() => setHoveredPii(null)}
                style={{
                  position: 'relative',
                }}
              >
                {getDisplayText(seg.text)}
                {isHovered && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: '50%',
                      transform: 'translateX(-50%) translateY(-6px)',
                      background: '#1e293b',
                      border: '1px solid rgba(239, 68, 68, 0.6)',
                      color: '#fca5a5',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                      zIndex: 50,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      display: 'inline-block',
                    }}
                  >
                    🔒 {seg.piiType}: {seg.originalVal}
                  </span>
                )}
              </span>
            );
          }

          if (seg.type === 'risk') {
            const risk = allRisks[seg.riskIndex!];
            const isUncapped =
              risk.risk_description.toLowerCase().includes('uncapped') ||
              risk.target.toLowerCase().includes('liability');
            const isActive = activeRiskIndex === seg.riskIndex;

            return (
              <span
                key={idx}
                id={`risk-span-${seg.riskIndex}`}
                className={isUncapped ? 'highlight-risk-uncapped' : 'highlight-risk-renewal'}
                onClick={() => {
                  setActiveRiskIndex(seg.riskIndex!);
                  setActiveTab('risks');
                }}
                style={{
                  borderWidth: isActive ? '2px' : '1px',
                  boxShadow: isActive
                    ? `0 0 12px ${isUncapped ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`
                    : undefined,
                }}
                title={`Risk identified: ${risk.risk_description}`}
              >
                {getDisplayText(seg.text)}
              </span>
            );
          }

          return <span key={idx}>{getDisplayText(seg.text)}</span>;
        })}
      </div>
    );
  };

  // Scroll left pane to the specific risk clause
  const scrollToRisk = (idx: number) => {
    const risk = auditResults?.identifiedRisks[idx];
    if (risk && risk.page) {
      setCurrentPage(risk.page);
    }
    setActiveRiskIndex(idx);
    setTimeout(() => {
      const element = document.getElementById(`risk-span-${idx}`);
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, 150);
  };

  // Metrics Calculations
  const totalContracts = documents.length;
  const pendingQueue = documents.filter(d => d.status === 'processing' || d.status === 'uploaded').length;
  const criticalRisks = documents.filter(d => d.riskLevel === 'High').length;
  const compliantFiles = documents.filter(d => d.status === 'completed' && d.riskLevel === 'Low').length;

  if (!token || !user) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          backgroundColor: 'var(--bg-base)',
          padding: '2rem',
        }}
      >
        <div
          className="glass-panel"
          style={{
            width: '100%',
            maxWidth: '440px',
            padding: '2.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            animation: 'fadeIn 0.4s ease-out',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'var(--bg-surface)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <img src="/logo.png" alt="Verilaw AI" style={{ height: '70px', objectFit: 'contain' }} />
            </div>
            <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              VERILAW <span style={{ color: 'var(--color-secondary)' }}>AI</span>
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {authMode === 'login' ? 'Sign in to access your Legal Audit Console' : 'Create an account to start auditing agreements'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {authError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: '#fca5a5',
                  fontSize: '0.8rem',
                }}
              >
                <AlertCircle size={16} />
                <span>{authError}</span>
              </div>
            )}
            
            {authSuccess && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: '#a7f3d0',
                  fontSize: '0.8rem',
                }}
              >
                <CheckCircle size={16} />
                <span>{authSuccess}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Username</label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={e => setAuthUsername(e.target.value)}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
                placeholder="e.g. general_counsel"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Password</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
                placeholder="••••••••"
              />
            </div>

            {authMode === 'signup' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                  Groq API Key (Mandatory)
                </label>
                <input
                  type="password"
                  required
                  value={authGroqKey}
                  onChange={e => setAuthGroqKey(e.target.value)}
                  style={{
                    background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                  placeholder="gsk_••••••••••••••••"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  To get your key, register on the{' '}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--color-secondary)', textDecoration: 'underline' }}
                  >
                    Groq Console
                  </a>
                  . Your key is encrypted at rest using AES-256.
                </span>
              </div>
            )}

            <button
              type="submit"
              style={{
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                border: 'none',
                color: '#fff',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(99, 102, 241, 0.25)',
                transition: 'transform 0.2s, opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {authMode === 'login' ? 'Sign In' : 'Register Account'}
            </button>
          </form>

          {/* Toggle */}
          <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {authMode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            </span>
            <button
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthError(null);
                setAuthSuccess(null);
                setAuthUsername('');
                setAuthPassword('');
                setAuthGroqKey('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-secondary)',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {authMode === 'login' ? 'Sign Up' : 'Log In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg-base)' }}>
      
      {/* 1. Glassmorphic Navigation Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 2rem',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-surface)',
          backdropFilter: 'blur(16px)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => setSelectedDocId(null)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo.png" alt="Verilaw AI" style={{ height: '55px', objectFit: 'contain' }} />
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-title)', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              VERILAW <span style={{ color: 'var(--color-secondary)' }}>AI</span>
            </h1>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Security & Legal Auditing
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '1rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#a5b4fc', fontWeight: 500 }}>
                Logged in as <strong style={{ color: 'var(--text-primary)' }}>{user.username}</strong>
              </span>
              <button
                onClick={handleLogout}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                }}
              >
                Log Out
              </button>
            </div>
          )}

          <div
            style={{
              fontSize: '0.8rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border-color)',
              padding: '6px 12px',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Lock size={14} color="#06b6d4" />
            <span>Secure Sandbox API</span>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column' }}>
        
        {!selectedDocId ? (
          /* ========================================================
             VIEW 1: DASHBOARD
             ======================================================== */
          <div style={{ animation: 'fadeIn 0.4s ease-out', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            {/* Page Header */}
            <div>
              <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                Legal Audit Console
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Upload corporate agreements for automated PII scrubbing and AI-powered risk identification.
              </p>
            </div>

            {/* Metrics Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              <div className="glass-panel glass-panel-hover" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ background: 'rgba(99, 102, 241, 0.12)', padding: '12px', borderRadius: '12px', color: 'var(--color-primary)' }}>
                  <FileText size={28} />
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Documents</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-title)' }}>{totalContracts}</p>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '12px', borderRadius: '12px', color: 'var(--color-danger)' }}>
                  <AlertCircle size={28} />
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Critical Risk Files</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-title)', color: 'var(--color-danger)' }}>{criticalRisks}</p>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ background: 'rgba(6, 182, 212, 0.12)', padding: '12px', borderRadius: '12px', color: 'var(--color-secondary)' }}>
                  <Loader size={28} className={pendingQueue > 0 ? 'animate-spin' : ''} style={{ animation: pendingQueue > 0 ? 'spin 3s linear infinite' : 'none' }} />
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>In the Queue</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-title)' }}>{pendingQueue}</p>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.12)', padding: '12px', borderRadius: '12px', color: 'var(--color-success)' }}>
                  <CheckCircle size={28} />
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compliant Reports</p>
                  <p style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-title)', color: '#a7f3d0' }}>{compliantFiles}</p>
                </div>
              </div>
            </div>

            {/* Split Section: Upload and Documents List */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '2rem', alignItems: 'start' }}>
              
              {/* Left Column: Drag & Drop Box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="glass-panel"
                  style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    border: '2px dashed rgba(99, 102, 241, 0.25)',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    animation: isUploading ? 'pulseBorder 2s infinite' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                  }}
                  onClick={triggerSelectFile}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    accept=".pdf,.txt,.png,.jpg,.jpeg"
                    style={{ display: 'none' }}
                  />
                  
                  {isUploading ? (
                    <>
                      <div style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-primary)' }}>
                        <Loader size={48} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' }}>Uploading Contract...</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Extracting text contents and anonymizing PII data...</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: 'rgba(99, 102, 241, 0.65)' }}>
                        <UploadCloud size={52} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem', fontFamily: 'var(--font-title)' }}>
                          Drop contract here, or browse
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          Supports Searchable PDF, Plain Text (.txt), or Scanned Images (.png, .jpg) for OCR
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {uploadError && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      padding: '1rem',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      color: '#fca5a5',
                      fontSize: '0.85rem',
                    }}
                  >
                    <AlertCircle size={18} />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>

              {/* Right Column: Files List */}
              <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, fontFamily: 'var(--font-title)' }}>Uploaded Contracts</h3>
                  <div style={{ position: 'relative', width: '180px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Search files..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border-color)',
                        padding: '6px 10px 6px 28px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                  {documents.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                      <FileSearch size={36} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                      <p style={{ fontSize: '0.9rem' }}>No contracts uploaded yet</p>
                    </div>
                  ) : (
                    documents
                      .filter(doc => doc.filename.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(doc => {
                        const isProcessing = doc.status === 'processing' || doc.status === 'uploaded';
                        return (
                          <div
                            key={doc.id}
                            className="glass-panel glass-panel-hover"
                            onClick={() => setSelectedDocId(doc.id)}
                            style={{
                              padding: '1rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '1rem',
                              borderLeft: doc.status === 'completed'
                                ? `3px solid ${doc.riskLevel === 'High' ? 'var(--color-danger)' : doc.riskLevel === 'Medium' ? 'var(--color-warning)' : 'var(--color-success)'}`
                                : isProcessing
                                ? '3px solid var(--color-primary)'
                                : '3px solid var(--text-disabled)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                              <FileText size={20} color={isProcessing ? 'var(--color-primary)' : 'var(--text-muted)'} />
                              <div style={{ overflow: 'hidden' }}>
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                  {doc.filename}
                                </h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  <span>{(() => { const d = new Date(doc.createdAt); return isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(); })()}</span>
                                  {doc.contractType && (
                                    <>
                                      <span>•</span>
                                      <span style={{ color: 'var(--text-primary)' }}>{doc.contractType}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              {doc.status === 'completed' ? (
                                <span
                                  style={{
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    textTransform: 'uppercase',
                                    background: doc.riskLevel === 'High'
                                      ? 'rgba(239, 68, 68, 0.15)'
                                      : doc.riskLevel === 'Medium'
                                      ? 'rgba(245, 158, 11, 0.15)'
                                      : 'rgba(16, 185, 129, 0.15)',
                                    color: doc.riskLevel === 'High'
                                      ? '#b91c1c'
                                      : doc.riskLevel === 'Medium'
                                      ? '#b45309'
                                      : '#047857',
                                  }}
                                >
                                  {doc.riskLevel} Risk
                                </span>
                              ) : isProcessing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
                                    <Loader size={12} style={{ animation: 'spin 1.5s linear infinite' }} />
                                    <span style={{ fontWeight: 500, fontSize: '0.7rem' }}>{doc.progressStep || 'Auditing...'}</span>
                                  </div>
                                  <div style={{ width: '80px', height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${doc.progressPercent || 10}%`, height: '100%', background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))', transition: 'width 0.5s ease-in-out' }}></div>
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>Failed</span>
                              )}
                              <button
                                onClick={(e) => handleDeleteOrCancel(doc.id, e)}
                                title={isProcessing ? "Cancel Audit" : "Delete Contract"}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text-disabled)',
                                  cursor: 'pointer',
                                  padding: '4px',
                                  borderRadius: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'all 0.2s',
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.color = 'var(--color-danger)';
                                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.color = 'var(--text-disabled)';
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                {isProcessing ? <XCircle size={16} /> : <Trash2 size={16} />}
                              </button>
                              <ChevronRight size={16} color="var(--text-disabled)" />
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

            </div>

          </div>
        ) : (
          /* ========================================================
             VIEW 2: DUAL-PANE REVIEW DETAIL WORKSPACE
             ======================================================== */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.3s ease-out' }}>
            
            {/* Header Details Panel */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  onClick={() => setSelectedDocId(null)}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    padding: '8px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-title)' }}>
                    {detailDoc?.filename || 'Loading document...'}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>Uploaded: {detailDoc ? (() => { const d = new Date(detailDoc.createdAt); return isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString(); })() : ''}</span>
                    {detailDoc?.selectedModel && (
                      <>
                        <span>•</span>
                        <span>Audited with {detailDoc.selectedModel}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {detailDoc && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {detailDoc.status === 'completed' && (
                    <>
                      <div style={{ textAlign: 'right' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            textTransform: 'uppercase',
                            background: detailDoc.riskLevel === 'High'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : detailDoc.riskLevel === 'Medium'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(16, 185, 129, 0.15)',
                            color: detailDoc.riskLevel === 'High'
                              ? '#b91c1c'
                              : detailDoc.riskLevel === 'Medium'
                              ? '#b45309'
                              : '#047857',
                          }}
                        >
                          {detailDoc.riskLevel} Risk Profile
                        </span>
                      </div>
                      
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                          padding: '4px 12px',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          color: 'var(--text-primary)',
                        }}
                      >
                        Type: <strong style={{ color: 'var(--color-secondary)' }}>{detailDoc.contractType}</strong>
                      </div>
                    </>
                  )}

                  {detailDoc.status === 'processing' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(99, 102, 241, 0.08)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.2)' }}>
                        <Loader size={14} style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-primary)' }} />
                        <span style={{ fontSize: '0.8rem', color: '#a5b4fc', fontWeight: 500 }}>
                          {detailDoc.progressStep || 'Running LangGraph Legal Workers...'}
                        </span>
                      </div>
                      <div style={{ width: '200px', height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${detailDoc.progressPercent || 10}%`, height: '100%', background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))', transition: 'width 0.5s ease-in-out' }}></div>
                      </div>
                    </div>
                  )}

                  {detailDoc.status === 'failed' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
                      <AlertCircle size={16} />
                      <span>Audit Failed</span>
                    </div>
                  )}

                  <button
                    onClick={(e) => handleDeleteOrCancel(detailDoc.id, e)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: '#fca5a5',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.8rem',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                    }}
                  >
                    {detailDoc.status === 'processing' || detailDoc.status === 'uploaded' ? (
                      <>
                        <XCircle size={14} />
                        <span>Cancel Audit</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        <span>Delete Contract</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Split Screen Layout */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem', minHeight: '520px', alignItems: 'stretch' }}>
              
              {/* Left Pane: Document Viewer */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div
                  style={{
                    padding: '0.75rem 1.25rem',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(0,0,0,0.1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={16} color="var(--color-secondary)" />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Document Viewer</span>
                  </div>

                  {/* Pagination Controls */}
                  {detailDoc && (() => {
                    const pages = getPages(detailDoc.scrubbedText);
                    const totalPages = pages.length;
                    if (totalPages <= 1) return null;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <button
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: currentPage === 1 ? 'var(--text-disabled)' : 'var(--text-primary)',
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, minWidth: '70px', textAlign: 'center', color: 'var(--text-primary)' }}>
                          Page {currentPage} of {totalPages}
                        </span>
                        <button
                          disabled={currentPage === totalPages}
                          onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: currentPage === totalPages ? 'var(--text-disabled)' : 'var(--text-primary)',
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    );
                  })()}

                  {/* Toggle Switch */}
                  {detailDoc && (
                    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <button
                        onClick={() => setViewMode('scrubbed')}
                        style={{
                          background: viewMode === 'scrubbed' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: viewMode === 'scrubbed' ? '#fca5a5' : 'var(--text-muted)',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <ShieldCheck size={12} />
                        <span>PII Redacted</span>
                      </button>
                      <button
                        onClick={() => setViewMode('original')}
                        style={{
                          background: viewMode === 'original' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: viewMode === 'original' ? '#fca5a5' : 'var(--text-muted)',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <EyeOff size={12} />
                        <span>Original Text</span>
                      </button>
                    </div>
                  )}
                </div>

                <div
                  ref={leftPaneRef}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    padding: '1.5rem',
                    overflowY: 'auto',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.92rem',
                    color: 'var(--text-primary)',
                    backgroundColor: 'rgba(0,0,0,0.15)',
                  }}
                >
                  {!detailDoc ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                      <Loader size={32} style={{ animation: 'spin 1.5s linear infinite' }} />
                    </div>
                  ) : (
                    renderDocumentText()
                  )}
                </div>
              </div>

              {/* Right Pane: Analysis Board */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                
                {/* Navigation Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                  <button
                    onClick={() => setActiveTab('summary')}
                    disabled={detailDoc?.status !== 'completed'}
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === 'summary' ? '2px solid var(--color-primary)' : '2px solid transparent',
                      color: activeTab === 'summary' ? '#fff' : 'var(--text-muted)',
                      padding: '1rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: detailDoc?.status === 'completed' ? 'pointer' : 'not-allowed',
                      opacity: detailDoc?.status === 'completed' ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <Layers size={14} />
                    <span>Executive Brief</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('risks')}
                    disabled={detailDoc?.status !== 'completed'}
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === 'risks' ? '2px solid var(--color-primary)' : '2px solid transparent',
                      color: activeTab === 'risks' ? '#fff' : 'var(--text-muted)',
                      padding: '1rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: detailDoc?.status === 'completed' ? 'pointer' : 'not-allowed',
                      opacity: detailDoc?.status === 'completed' ? 1 : 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>Risks Found ({auditResults?.identifiedRisks.length || 0})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('scrubber')}
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === 'scrubber' ? '2px solid var(--color-primary)' : '2px solid transparent',
                      color: activeTab === 'scrubber' ? '#fff' : 'var(--text-muted)',
                      padding: '1rem',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <ShieldCheck size={14} />
                    <span>Privacy Scrubber ({detailDoc?.piiMapping.length || 0})</span>
                  </button>
                </div>

                {/* Tab content panel */}
                <div style={{ flex: 1, minHeight: 0, padding: '1.5rem', overflowY: 'auto' }}>
                  
                  {!detailDoc ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                      <Loader size={24} style={{ animation: 'spin 1.5s linear infinite' }} />
                    </div>
                  ) : (
                    <>
                      {/* Tab 1: Executive Summary */}
                      {activeTab === 'summary' && auditResults && (
                        <div className="markdown-content" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                          <Markdown>{auditResults.executiveSummary}</Markdown>
                        </div>
                      )}

                      {/* Tab 2: Identified Risks */}
                      {activeTab === 'risks' && auditResults && (() => {
                        const allRisks = auditResults.identifiedRisks || [];
                        const filteredRisks = filterRisksByPage 
                          ? allRisks.map((r, idx) => ({ ...r, originalIdx: idx })).filter(r => r.page === currentPage)
                          : allRisks.map((r, idx) => ({ ...r, originalIdx: idx }));

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', animation: 'fadeIn 0.2s ease-out' }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                paddingBottom: '0.75rem',
                                borderBottom: '1px solid var(--border-color)',
                                gap: '0.5rem',
                                flexWrap: 'wrap'
                              }}
                            >
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {filterRisksByPage ? `Page ${currentPage} Risks (${filteredRisks.length})` : `All Risks (${allRisks.length})`}
                              </span>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem', color: '#a5b4fc', userSelect: 'none' }}>
                                <input
                                  type="checkbox"
                                  checked={filterRisksByPage}
                                  onChange={(e) => setFilterRisksByPage(e.target.checked)}
                                  style={{
                                    accentColor: 'var(--color-primary)',
                                    cursor: 'pointer',
                                  }}
                                />
                                <span>Filter by current page</span>
                              </label>
                            </div>

                            {filteredRisks.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                <CheckCircle size={32} color="var(--color-success)" style={{ marginBottom: '0.5rem', opacity: 0.8 }} />
                                <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No Risks on Page {currentPage}</p>
                                <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                                  {filterRisksByPage ? "No auto-renewal or uncapped liability risks identified on this page." : "No material risks identified."}
                                </p>
                              </div>
                            ) : (
                              filteredRisks.map((risk) => {
                                const isUncapped =
                                  risk.risk_description.toLowerCase().includes('uncapped') ||
                                  risk.target.toLowerCase().includes('liability');
                                const isActive = activeRiskIndex === risk.originalIdx;

                                return (
                                  <div
                                    key={risk.originalIdx}
                                    onClick={() => scrollToRisk(risk.originalIdx)}
                                    className="glass-panel"
                                    style={{
                                      padding: '1rem',
                                      cursor: 'pointer',
                                      borderLeft: isUncapped ? '4px solid var(--color-danger)' : '4px solid var(--color-warning)',
                                      borderColor: isActive
                                        ? isUncapped
                                          ? 'var(--color-danger)'
                                          : 'var(--color-warning)'
                                        : 'rgba(0,0,0,0.04)',
                                      background: isActive
                                        ? isUncapped
                                          ? 'rgba(239, 68, 68, 0.08)'
                                          : 'rgba(245, 158, 11, 0.08)'
                                        : 'rgba(0,0,0,0.02)',
                                      transition: 'all 0.2s',
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isUncapped ? '#fca5a5' : '#fcd34d', textTransform: 'uppercase' }}>
                                        {isUncapped ? 'Liability Clause' : 'Auto-Renewal Clause'}
                                      </span>
                                      <span style={{ fontSize: '0.7rem', background: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                                        Page {risk.page}
                                      </span>
                                    </div>
                                    
                                    <blockquote style={{ fontSize: '0.85rem', borderLeft: '2px solid var(--border-color)', paddingLeft: '8px', margin: '0.5rem 0', color: 'var(--text-primary)', fontStyle: 'italic' }}>
                                      "{risk.clause}"
                                    </blockquote>

                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: '1.4' }}>
                                      <strong>Risk Assessment:</strong> {risk.risk_description}
                                    </p>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        );
                      })()}

                      {/* Tab 3: Privacy Scrubber */}
                      {activeTab === 'scrubber' && (() => {
                        const allPages = getPages(detailDoc.scrubbedText);
                        const pageText = allPages[Math.min(Math.max(currentPage - 1, 0), allPages.length - 1)] || '';
                        const allPii = detailDoc.piiMapping || [];
                        const filteredPii = filterPiiByPage
                          ? allPii.filter(item => pageText.includes(item.placeholder))
                          : allPii;

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.2s ease-out' }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                paddingBottom: '0.75rem',
                                borderBottom: '1px solid var(--border-color)',
                                gap: '0.5rem',
                                flexWrap: 'wrap'
                              }}
                            >
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {filterPiiByPage ? `Page ${currentPage} PII (${filteredPii.length})` : `All PII (${allPii.length})`}
                              </span>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem', color: '#a5b4fc', userSelect: 'none' }}>
                                <input
                                  type="checkbox"
                                  checked={filterPiiByPage}
                                  onChange={(e) => setFilterPiiByPage(e.target.checked)}
                                  style={{
                                    accentColor: 'var(--color-primary)',
                                    cursor: 'pointer',
                                  }}
                                />
                                <span>Filter by current page</span>
                              </label>
                            </div>
                          <div style={{ background: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.15)', padding: '1rem', borderRadius: '8px', display: 'flex', gap: '0.75rem' }}>
                            <Info size={20} color="var(--color-secondary)" style={{ flexShrink: 0 }} />
                            <div>
                              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>Zero PII Leakage Architecture</h4>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                Before this contract was sent to the LLM backend, the Privacy Scrubber extracted and replaced all sensitive fields with secure mapping keys. Hover over redacted terms in the left pane to reveal details.
                              </p>
                            </div>
                          </div>

                          {filteredPii.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                              <ShieldCheck size={32} color="var(--color-success)" style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                              <p style={{ fontSize: '0.85rem' }}>No PII detected in this contract</p>
                            </div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                                  <th style={{ padding: '8px 4px', fontWeight: 500 }}>Category</th>
                                  <th style={{ padding: '8px 4px', fontWeight: 500 }}>Placeholder</th>
                                  <th style={{ padding: '8px 4px', fontWeight: 500 }}>Original Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredPii.map((item, idx) => (
                                  <tr
                                    key={idx}
                                    style={{
                                      borderBottom: '1px solid var(--border-color)',
                                      background: hoveredPii?.placeholder === item.placeholder ? 'rgba(6,182,212,0.06)' : 'transparent',
                                      transition: 'background 0.2s',
                                    }}
                                    onMouseEnter={() => setHoveredPii({ placeholder: item.placeholder, original: item.original })}
                                    onMouseLeave={() => setHoveredPii(null)}
                                  >
                                    <td style={{ padding: '10px 4px' }}>
                                      <span style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                        {item.type}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 4px', fontFamily: 'monospace', color: '#22d3ee' }}>{item.placeholder}</td>
                                    <td style={{ padding: '10px 4px', color: 'var(--text-primary)' }}>{item.original}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        );
                      })()}
                    </>
                  )}

                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-color)',
          padding: '1rem 2rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          background: 'rgba(0,0,0,0.2)',
        }}
      >
        <span>Verilaw AI Enterprise Legal Hub. Powered by LangGraph, Express, and Drizzle ORM.</span>
      </footer>

    </div>
  );
}
