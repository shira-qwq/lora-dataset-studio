/**
 * ⚡ React V2 Frontend — 主力开发前端
 *
 * 维护状态: 主力开发
 * - 新功能/修复优先在此实现
 * - Legacy frontend (studio/frontend/) 仅做兼容维护
 * - 启动命令: cd studio/frontend_react && npm run dev
 * - 构建命令: npm run build (产物由 FastAPI 托管于 /react/)
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnalysisPage from './pages/AnalysisPage';
import OrganizePage from './pages/OrganizePage';
import NewAnalysisPage from './pages/NewAnalysisPage';
import AppShell from './components/layout/AppShell';

export default function App() {
  return (
    <BrowserRouter basename="/react">
      <Routes>
        {/* Home: normal shell */}
        <Route path="/" element={<AppShell mode="normal"><HomePage /></AppShell>} />
        <Route path="/analysis" element={<AppShell mode="normal"><AnalysisPage /></AppShell>} />
        <Route path="/analysis/" element={<AppShell mode="normal"><AnalysisPage /></AppShell>} />
        {/* Organize: fullBleed shell — no width constraints */}
        <Route path="/organize" element={<AppShell mode="fullBleed"><OrganizePage /></AppShell>} />
        <Route path="/organize/" element={<AppShell mode="fullBleed"><OrganizePage /></AppShell>} />
        <Route path="/new-analysis" element={<AppShell mode="normal"><NewAnalysisPage /></AppShell>} />
        <Route path="/new-analysis/" element={<AppShell mode="normal"><NewAnalysisPage /></AppShell>} />
      </Routes>
    </BrowserRouter>
  );
}
