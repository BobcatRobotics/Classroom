import { useState } from "react";
import { AdminLayout, type Tab } from "./AdminLayout";
import { Allowlist } from "./pages/Allowlist";
import { AuditLog } from "./pages/AuditLog";
import { Containers } from "./pages/Containers";
import { Dashboard } from "./pages/Dashboard";
import { LessonCompletionReport } from "./pages/LessonCompletionReport";
import { Users } from "./pages/Users";
import { Workspaces } from "./pages/Workspaces";

export function AdminApp() {
	const [tab, setTab] = useState<Tab>("dashboard");

	return (
		<AdminLayout activeTab={tab} onTabChange={setTab}>
			{tab === "dashboard" && <Dashboard />}
			{tab === "containers" && <Containers />}
			{tab === "workspaces" && <Workspaces />}
			{tab === "users" && <Users />}
			{tab === "lesson-completions" && <LessonCompletionReport />}
			{tab === "allowlist" && <Allowlist />}
			{tab === "audit-log" && <AuditLog />}
		</AdminLayout>
	);
}
