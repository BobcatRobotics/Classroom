import { ArrowRightLeft, CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface ProjectMenuProps {
	onSwitchProject: () => void;
	completion?: {
		eligible: boolean;
		loading: boolean;
		marking: boolean;
		message: string | null;
		onMark: () => void;
	};
}

export function ProjectMenu({ onSwitchProject, completion }: ProjectMenuProps) {
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
				{completion && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!completion.eligible || completion.marking}
							onClick={completion.onMark}
						>
							<CheckCircle2 className="size-4" aria-hidden="true" />
							<span>
								{completion.marking
									? "Marking lesson complete..."
									: "Mark lesson completed"}
							</span>
						</DropdownMenuItem>
						{!completion.eligible &&
							!completion.loading &&
							completion.message && (
								<p className="px-2 py-1 text-[11px] text-muted-foreground">
									{completion.message}
								</p>
							)}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
