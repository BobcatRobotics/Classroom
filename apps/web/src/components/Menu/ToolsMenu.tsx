import { ChevronDown, SettingsIcon, X } from "lucide-react";
import advantagescopeLogo from "@/assets/advantagescope-logo.png";
import pathplannerLogo from "@/assets/pathplanner-logo.png";
// import bLineLogo from "@/assets/bline-field26-logo.png"

import { Button } from "@/components/ui/button";
import type { WorkspaceTool } from "../SimPaneSwitcher";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface ToolsMenuProps {
	onSelectTool: (tool: WorkspaceTool) => void;
	onCloseTool: () => void;
}

export function ToolsMenu({ onSelectTool, onCloseTool }: ToolsMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 rounded-full border-border bg-card pl-1 pr-2"
					>
						<SettingsIcon className="size-4" aria-hidden="true" />
						<span>Tools</span>
						<ChevronDown className="size-3.5 text-muted-foreground" />
					</Button>
				}
			/>
			<DropdownMenuContent align="end" className="w-64 p-2">
				<DropdownMenuItem onClick={() => onSelectTool("scope")}>
					<img
						src={advantagescopeLogo}
						alt=""
						className="size-5 rounded-sm object-contain"
						aria-hidden="true"
					/>
					<span>AdvantageScope</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onSelectTool("pathplanner")}>
					<img
						src={pathplannerLogo}
						alt=""
						className="size-5 rounded-sm object-contain"
						aria-hidden="true"
					/>
					<span>PathPlanner</span>
				</DropdownMenuItem>
				{/* <DropdownMenuItem onClick={() => onSelectTool("bline")}>
            <img
                src={bLineLogo}
                alt=""
                className="size-5 rounded-sm object-contain"
                aria-hidden="true"
            />
            <span>BLine</span>
        </DropdownMenuItem> */}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onCloseTool}>
					<X className="size-4" aria-hidden="true" />
					<span>Close tool(s)</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
