import { ArrowRightLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface ProjectMenuProps {
	onSwitchProject: () => void;
}

export function ProjectMenu({ onSwitchProject }: ProjectMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 rounded-full border-border bg-card pl-1 pr-2"
					>
						<span>Projects</span>
						<ChevronDown className="size-3.5 text-muted-foreground" />
					</Button>
				}
			/>

			<DropdownMenuContent align="end" className="w-48 p-2">
				<DropdownMenuItem onClick={onSwitchProject}>
					<ArrowRightLeft className="size-4" aria-hidden="true" />
					<span>Switch project</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
