import coderunnerHeaderImg from "@/assets/coderunner-header.png";
import { ProjectMenu } from "@/components/Menu/ProjectMenu";
import { ToolsMenu } from "@/components/Menu/ToolsMenu";
import { UserMenu } from "@/components/Menu/UserMenu";
import type { WorkspaceTool } from "@/components/SimPaneSwitcher";

interface TopbarProps {
	displayName: string;
	email: string;
	avatarUrl: string | null;
	isAdmin: boolean;
	onSwitchProject: () => void;
	onSelectTool: (tool: WorkspaceTool) => void;
	onCloseTool: () => void;
	showTools?: boolean;
}

export function Topbar({
	displayName,
	email,
	avatarUrl,
	isAdmin,
	onSwitchProject,
	onSelectTool,
	onCloseTool,
	showTools,
}: TopbarProps) {
	return (
		<header className="flex h-[48px] shrink-0 items-center border-b border-border px-4">
			<div className="flex items-center gap-2.5">
				<img src={coderunnerHeaderImg} alt="" className="h-6 w-auto" />
				<strong className="whitespace-nowrap text-[13.5px] font-semibold tracking-tight">
					Bobcat Robotics CodeRunner
				</strong>
			</div>
			<div className="ml-auto flex items-center gap-5">
				{showTools && (
					<ToolsMenu onSelectTool={onSelectTool} onCloseTool={onCloseTool} />
				)}
				<ProjectMenu onSwitchProject={onSwitchProject} />
				<UserMenu
					displayName={displayName}
					email={email}
					avatarUrl={avatarUrl}
					isAdmin={isAdmin}
				/>
			</div>
		</header>
	);
}
