import { Replace } from "lucide-react";
import coderunnerHeaderImg from "@/assets/coderunner-header.png";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";

interface TopbarProps {
	displayName: string;
	email: string;
	avatarUrl: string | null;
	isAdmin: boolean;
	onSwitchProject: () => void;
}

export function Topbar({
	displayName,
	email,
	avatarUrl,
	isAdmin,
	onSwitchProject,
}: TopbarProps) {
	return (
		<header className="flex h-[48px] shrink-0 items-center border-b border-border px-4">
			<div className="flex items-center gap-2.5">
				<img src={coderunnerHeaderImg} alt="" className="h-6 w-auto" />
				<strong className="whitespace-nowrap text-[13.5px] font-semibold tracking-tight">
					Bobcat Robotics Classroom
				</strong>
			</div>
			<div className="ml-auto flex items-center gap-5">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 px-2.5 text-[12.5px]"
					onClick={onSwitchProject}
				>
					<Replace className="size-[15px] text-muted-foreground" />
					Switch project
				</Button>
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
