import { useEffect, useRef, useState } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import { Editor } from "./Editor";
import { EventBus } from "./game/EventBus";

const STARTER_CODE = `//Javascript
let counter = 0;
let direction = 'right';

//Track your own variable in the game HUD
track(counter);
track(direction);

//Runs once when you press run
function start() {
    moveRight();
    
    //Pause the function for 1000ms with sleep(1000)
    sleep(1000);
    stop();
    direction = 'stopped';
    sleep(1000);
}

//After start() completes, update() function runs every 100ms
function update() {
    counter++;

    if (counter < 20) {
         moveLeft();
        direction = 'left';
    } else {
        stop();
        direction = 'stopped';
    }
}
`;

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [code, setCode] = useState<string>(STARTER_CODE);
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

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

        EventBus.on("code-started", onCodeStarted);
        EventBus.on("code-stopped", onCodeStopped);
        EventBus.on("code-error", onCodeError);

        return () => {
            EventBus.removeListener("code-started", onCodeStarted);
            EventBus.removeListener("code-stopped", onCodeStopped);
            EventBus.removeListener("code-error", onCodeError);
        };
    }, []);

    // Send code execution request to the Phaser scene
    const handleRun = () => {
        setErrorMessage(null);
        EventBus.emit("run-code", code);
    };

    // Send stop request to the Phaser scene
    const handleStop = () => {
        EventBus.emit("stop-code");
    };

    return (
        <div id="app">
            {/* Left side: Phaser Game Viewport */}
            <div className="game-view">
                <PhaserGame ref={phaserRef} />
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
                        defaultValue={STARTER_CODE}
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
                                            setCode(STARTER_CODE);
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

