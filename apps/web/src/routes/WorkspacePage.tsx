import { LoaderPinwheel } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { DemoBanner } from "@/components/DemoBanner";
import { DriverStation } from "@/components/DriverStation";
import { EditorPane } from "@/components/EditorPane";
import { IDELayout } from "@/components/IDELayout";
import { PathPlannerPane } from "@/components/PathPlannerPane";
import { ScopePane } from "@/components/ScopePane";
import {
	type ActiveTool,
	SimPanePanels,
	type WorkspaceTool,
} from "@/components/SimPaneSwitcher";
import { SwitchProjectDialog } from "@/components/SwitchProjectDialog";
import { Topbar } from "@/components/Topbar";
import { useAutoChoosers } from "@/hooks/useAutoChoosers";
import { useContainerStatus } from "@/hooks/useContainerStatus";
import { useEditorReachability } from "@/hooks/useEditorReachability";
import { type GamepadInfo, useGamepad } from "@/hooks/useGamepad";
import { useGamepadChannel } from "@/hooks/useGamepadChannel";
import { useRunChannel } from "@/hooks/useRunChannel";
import { useScopeHandshake } from "@/hooks/useScopeHandshake";
import { useSession } from "@/hooks/useSession";
import { useSimulationState } from "@/hooks/useSimulationState";
import { isWorkspaceSlug } from "@/lib/contracts";
import { gamepadFrameToWpilib } from "@/lib/gamepad-mapping";
import {
	gamepadStateToVisualizerFrame,
	KEYBOARD_GAMEPAD_ID,
	KEYBOARD_GAMEPAD_LABEL,
	keyboardCodesToWpilib,
	NEUTRAL_GAMEPAD_STATE,
} from "@/lib/keyboard-mapping";
import { useUIStore } from "@/state/store";

export function WorkspacePage() {
	const { slug } = useParams<{ slug: string }>();
	const workspaceSlug = useMemo(
		() => (slug && isWorkspaceSlug(slug) ? slug : null),
		[slug],
	);

	// Bumped after a project swap so the session refetches and the editor remounts.
	const [reloadNonce, setReloadNonce] = useState(0);
	const [editorLoaded, setEditorLoaded] = useState(false);
	const sessionState = useSession(workspaceSlug, reloadNonce);
	const containerStatus = useContainerStatus(workspaceSlug);

	const workspace =
		sessionState.status === "ready" ? sessionState.session.workspace : null;
	const currentModule = workspace?.currentModule ?? null;
	const currentModuleKind = workspace?.currentModuleKind ?? null;
	const projectEmpty = workspace?.projectEmpty ?? false;

	// `plain-java` console lessons hide the sim chrome; everything else (robot
	// lessons, empty workspace, team import) renders the full robot layout.
	const isConsoleModule = currentModuleKind === "plain-java";
	// Gate the sim data hooks themselves (not just rendering): they no-op on a
	// null slug, so console mode stops the sim polls + idle HALSim/run sockets.
	const simSlug = isConsoleModule ? null : workspaceSlug;

	const [switchOpen, setSwitchOpen] = useState(false);
	const [activeTool, setActiveTool] = useState<ActiveTool>(null);

	const { connection: runConnection, consoleLines } = useRunChannel(simSlug);
	const simulation = useSimulationState(simSlug);
	const autoChoosers = useAutoChoosers(simSlug);
	const editorUrl = workspaceSlug
		? `/u/${workspaceSlug}/vscode/?folder=/workspace/project`
		: null;
	const {
		status: editorStatus,
		waitingSeconds: editorWaitingSeconds,
		errorDetail: editorErrorDetail,
	} = useEditorReachability(editorUrl);
	const scopeFrameRef = useRef<HTMLIFrameElement>(null);
	useScopeHandshake(activeTool === "scope" ? simSlug : null, scopeFrameRef);

	const gamepad = useGamepad();
	const channel = useGamepadChannel(simSlug);
	const inputMode = useUIStore((state) => state.inputMode);
	const setInputMode = useUIStore((state) => state.setInputMode);
	const [keyboardCodes, setKeyboardCodes] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const keyboardState = useMemo(
		() => keyboardCodesToWpilib(keyboardCodes),
		[keyboardCodes],
	);
	const keyboardFrame = useMemo(
		() => gamepadStateToVisualizerFrame(keyboardState),
		[keyboardState],
	);

	useEffect(() => {
		if (isConsoleModule) {
			setActiveTool(null);
		}
	}, [isConsoleModule]);

	// Bridge: when a gamepad frame arrives, ship the WPILib-mapped state to
	// the channel. pushState handles its own throttle / heartbeat / diffing,
	// so we can call it on every frame without burning bandwidth.
	useEffect(() => {
		if (
			inputMode !== "controller" ||
			!gamepad.frame ||
			gamepad.selectedIndex === null
		)
			return;
		channel.pushState(gamepadFrameToWpilib(gamepad.frame));
	}, [inputMode, gamepad.frame, gamepad.selectedIndex, channel]);

	useEffect(() => {
		if (inputMode !== "keyboard") return;
		channel.pushState(keyboardState);
	}, [inputMode, keyboardState, channel]);

	const onSelectGamepad = useCallback(
		(info: GamepadInfo) => {
			setInputMode("controller");
			setKeyboardCodes(new Set());
			gamepad.selectGamepad(info.index);
			channel.select(info.id, info.label);
		},
		[gamepad, channel, setInputMode],
	);

	const onReleaseGamepad = useCallback(() => {
		gamepad.selectGamepad(null);
		channel.release();
	}, [gamepad, channel]);

	const onSelectControllerMode = useCallback(() => {
		setInputMode("controller");
		setKeyboardCodes(new Set());
		const selected = gamepad.available.find(
			(info) => info.index === gamepad.selectedIndex,
		);
		if (selected) {
			channel.select(selected.id, selected.label);
		} else {
			channel.release();
		}
	}, [channel, gamepad.available, gamepad.selectedIndex, setInputMode]);

	const onSelectKeyboardMode = useCallback(() => {
		setInputMode("keyboard");
		gamepad.selectGamepad(null);
		setKeyboardCodes(new Set());
		channel.select(KEYBOARD_GAMEPAD_ID, KEYBOARD_GAMEPAD_LABEL);
		channel.pushState(NEUTRAL_GAMEPAD_STATE);
	}, [channel, gamepad, setInputMode]);

	const onKeyboardCodesChange = useCallback((codes: ReadonlySet<string>) => {
		setKeyboardCodes(codes);
	}, []);

	const onKeyboardRelease = useCallback(() => {
		setKeyboardCodes(new Set());
		if (inputMode === "keyboard") {
			channel.pushState(NEUTRAL_GAMEPAD_STATE);
		}
	}, [channel, inputMode]);

	const onSelectTool = useCallback((tool: WorkspaceTool) => {
		setActiveTool(tool);
	}, []);

	const onCloseTool = useCallback(() => {
		setActiveTool(null);
	}, []);

	// Safety: if the selected gamepad disappears (useGamepad clears
	// selectedIndex), tell the server to release.
	const lastSelectedRef = useRef<number | null>(null);
	useEffect(() => {
		if (
			inputMode === "controller" &&
			lastSelectedRef.current !== null &&
			gamepad.selectedIndex === null
		) {
			channel.release();
		}
		lastSelectedRef.current = gamepad.selectedIndex;
	}, [inputMode, gamepad.selectedIndex, channel]);

	// First login (D7): an empty workspace auto-opens the Switch Project surface
	// so the student starts by picking a lesson. Fire once per empty state.
	const autoOpenedRef = useRef(false);
	useEffect(() => {
		if (projectEmpty && !autoOpenedRef.current) {
			autoOpenedRef.current = true;
			setSwitchOpen(true);
		}
		if (!projectEmpty) {
			autoOpenedRef.current = false;
		}
	}, [projectEmpty]);

	const onSwapComplete = useCallback(() => {
		setEditorLoaded(false);
		setReloadNonce((n) => n + 1);
	}, []);

	const displayName =
		sessionState.status === "ready"
			? sessionState.session.user.displayName
			: "Loading";
	const email =
		sessionState.status === "ready" ? sessionState.session.user.email : "";
	const avatarUrl =
		sessionState.status === "ready"
			? sessionState.session.user.avatarUrl
			: null;
	const isAdmin =
		sessionState.status === "ready" &&
		sessionState.session.user.role === "admin";
	const isDemo =
		sessionState.status === "ready" && sessionState.session.demo === true;

	const sessionReady = sessionState.status === "ready";
	const workspaceReady =
		sessionReady &&
		containerStatus?.code.ready === true &&
		editorStatus === "reachable" &&
		editorLoaded;
	const workspaceSettingUp = sessionReady && !workspaceReady;
	const errorMessage =
		sessionState.status === "error" ? sessionState.message : undefined;

	return (
		<div className="relative flex h-screen flex-col gap-0 bg-background">
			{isDemo && <DemoBanner />}
			<Topbar
				displayName={displayName}
				email={email}
				avatarUrl={avatarUrl}
				isAdmin={isAdmin}
				onSwitchProject={() => setSwitchOpen(true)}
				onSelectTool={onSelectTool}
				onCloseTool={onCloseTool}
				showTools={!isConsoleModule}
			/>
			<IDELayout
				activeTool={activeTool}
				showSimPanels={!isConsoleModule}
				editor={
					<EditorPane
						key={reloadNonce}
						editorUrl={editorUrl}
						editorStatus={editorStatus}
						errorMessage={errorMessage}
						waitingSeconds={editorWaitingSeconds}
						errorDetail={editorErrorDetail}
						onReady={() => setEditorLoaded(true)}
					/>
				}
				scope={
					<SimPanePanels
						activeTool={activeTool}
						scope={<ScopePane ref={scopeFrameRef} />}
						pathplanner={
							<PathPlannerPane key={reloadNonce} workspaceSlug={simSlug} />
						}
						bline={null} // TODO: When bline is ready
					/>
				}
				driverStation={
					<DriverStation
						simulationStatus={simulation.status}
						runStatus={simulation.runStatus}
						runConnection={runConnection}
						sessionReady={sessionReady}
						consoleLines={consoleLines}
						autoStatus={autoChoosers.status}
						gamepad={{
							inputMode,
							available: gamepad.available,
							selectedIndex: gamepad.selectedIndex,
							frame: gamepad.frame,
							keyboardFrame,
							keyboardPressedCodes: keyboardCodes,
							channelConnection: channel.connection,
							channelHalsimDisconnected: channel.halsimDisconnected,
							onSelectControllerMode,
							onSelectKeyboardMode,
							onKeyboardCodesChange,
							onKeyboardRelease,
							onSelect: onSelectGamepad,
							onRelease: onReleaseGamepad,
						}}
						onStartRun={simulation.startRun}
						onStopRun={simulation.stopRun}
						onRestartRun={simulation.restartRun}
						onSetDriverStation={simulation.setDriverStation}
						onSelectAuto={autoChoosers.selectAuto}
					/>
				}
			/>
			<SwitchProjectDialog
				open={switchOpen}
				onOpenChange={setSwitchOpen}
				workspaceSlug={workspaceSlug}
				currentModule={currentModule}
				onSwapComplete={onSwapComplete}
			/>
			{workspaceSettingUp && (
				<div
					className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 px-6 text-center backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-label="Workspace setup in progress"
				>
					<div className="flex max-w-lg flex-col items-center gap-4">
						<div className="flex size-12 items-center justify-center rounded-full border border-border bg-card">
							<LoaderPinwheel className="size-6 animate-spin text-primary" />
						</div>
						<div className="flex flex-col items-center gap-1 text-center font-mono text-sm text-foreground">
								<div>Please wait while your workspace loads.</div>
								<div>This may take a few minutes...</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
