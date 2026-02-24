/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Discovery from "./pages/Discovery";
import Leads from "./pages/Leads";
import LeadDetail from "./pages/LeadDetail";
import Settings from "./pages/Settings";
import Conversations from "./pages/Conversations";
import Campaigns from "./pages/Campaigns";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="leads" element={<Leads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<div className="p-8">Page not found</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

