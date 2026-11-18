import { useEffect, useRef, useState } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import { Editor } from "./Editor";
import { EventBus } from "./game/EventBus";
import {
    getLevelDefinition,
    getLevelIdFromUrl,
    LEVELS,
    setLevelIdInUrl,
} from "./game/Levels/levels";
import { useSavedCode } from "./storage";

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [currentLevelId, setCurrentLevelId] = useState<number>(() =>
        getLevelIdFromUrl(),
    );
    const currentLevel = getLevelDefinition(currentLevelId);
    const currentLevelIndex = LEVELS.findIndex((l) => l.id === currentLevelId);
    const nextLevel =
        currentLevelIndex >= 0 && currentLevelIndex + 1 < LEVELS.length
            ? LEVELS[currentLevelIndex + 1]
            : null;

    const [code, setCode] = useSavedCode(
        currentLevelId,
        currentLevel.starterCode,
    );
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [isLevelComplete, setIsLevelComplete] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    // --- Sync URL ?level=<id> on initial mount and browser Back/Forward ---
    useEffect(() => {
        setLevelIdInUrl(getLevelIdFromUrl(), true);

        const onPopState = () => {
            const urlLevelId = getLevelIdFromUrl();
            setCurrentLevelId(urlLevelId);
            setIsLevelComplete(false);
            setErrorMessage(null);
            EventBus.emit("load-level", urlLevelId);
        };

        window.addEventListener("popstate", onPopState);
        return () => {
            window.removeEventListener("popstate", onPopState);
        };
    }, []);

    // --- Listen to Phaser scene events via EventBus ---
    useEffect(() => {
        const onCodeStarted = () => {
            setIsRunning(true);
            setErrorMessage(null);
        };

        const onCodeStopped = () => {
            setIsRunning(false);
        };

        const onCodeError = (errorMsg: string) => {
            setIsRunning(false);
            setErrorMessage(errorMsg);
        };

        const onLevelComplete = () => {
            setIsRunning(false);
            setIsLevelComplete(true);
        };

        EventBus.on("code-started", onCodeStarted);
        EventBus.on("code-stopped", onCodeStopped);
        EventBus.on("code-error", onCodeError);
        EventBus.on("level-complete", onLevelComplete);

        return () => {
            EventBus.removeListener("code-started", onCodeStarted);
            EventBus.removeListener("code-stopped", onCodeStopped);
            EventBus.removeListener("code-error", onCodeError);
            EventBus.removeListener("level-complete", onLevelComplete);
        };
    }, []);

    // Send code execution request to the Phaser scene
    const handleRun = () => {
        setErrorMessage(null);
        setIsLevelComplete(false);
        EventBus.emit("run-code", code);
    };

    // Send stop request to the Phaser scene
    const handleStop = () => {
        setIsLevelComplete(false);
        EventBus.emit("stop-code");
    };

    // Reset current level simulation back to spawn
    const handleRestartLevel = () => {
        setIsLevelComplete(false);
        setErrorMessage(null);
        EventBus.emit("stop-code");
    };

    // Switch to the next level and load its own saved code
    const handleNextLevel = () => {
        if (!nextLevel) return;
        setIsLevelComplete(false);
        setErrorMessage(null);
        setCurrentLevelId(nextLevel.id);
        setLevelIdInUrl(nextLevel.id, false);
        EventBus.emit("load-level", nextLevel.id);
    };

    return (
        <div id="app">
            {/* Left side: Phaser Game Viewport */}
            <div className="game-view">
                <PhaserGame ref={phaserRef} />
                {isLevelComplete && (
                    <div className="modal-overlay">
                        <div className="modal level-complete-modal">
                            <h2>Level Complete!</h2>
                            <p>{currentLevel.name} completed.</p>
                            <div className="modal-actions level-complete-actions">
                                <button
                                    className="button btn-secondary"
                                    onClick={handleRestartLevel}
                                >
                                    Restart
                                </button>
                                <button
                                    className="button btn-run"
                                    onClick={handleNextLevel}
                                    disabled={!nextLevel}
                                >
                                    {nextLevel
                                        ? `Next Level (${nextLevel.name})`
                                        : "All Levels Complete"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right side: Code Editor & Controls */}
            <div className="editor-view">
                <div className="editor-toolbar">
                    <button
                        className={`button ${isRunning ? "btn-stop" : "btn-run"}`}
                        onClick={isRunning ? handleStop : handleRun}
                    >
                        {isRunning ? "⏹ Stop" : "▶ Run"}
                    </button>
                    <span
                        className={`status-text ${isRunning ? "running" : ""}`}
                    >
                        {isRunning ? "● Running" : "○ Stopped"}
                    </span>
                    <button
                        className="button btn-reset"
                        onClick={() => setShowConfirm(true)}
                        disabled={isRunning}
                    >
                        ↺ Reset
                    </button>
                </div>

                <div className="editor-content">
                    <Editor
                        defaultValue={code}
                        value={code}
                        onChange={setCode}
                    />
                    {showConfirm && (
                        <div
                            className="modal-overlay"
                            onClick={() => setShowConfirm(false)}
                        >
                            <div
                                className="modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <p>
                                    Are you sure you want to reset the editor
                                    back to the starter code?
                                </p>
                                <div className="modal-actions">
                                    <button
                                        className="button"
                                        onClick={() => setShowConfirm(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="button btn-stop"
                                        onClick={() => {
                                            setCode(currentLevel.starterCode);
                                            setShowConfirm(false);
                                        }}
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {errorMessage && (
                    <div className="error-banner">
                        <strong>Error:</strong> {errorMessage}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;

