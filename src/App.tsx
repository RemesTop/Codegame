import { useEffect, useRef, useState } from 'react';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { Editor } from './Editor';
import { EventBus } from './game/EventBus';

const STARTER_CODE = `//Javascript
let counter = 0;

//Track your own variable in the game view
track(counter);

//update() function runs every 100ms
function update() {
  counter++;

  if (counter < 20) {
    moveRight();
  } else if (counter < 50) {
    moveLeft();
  } else {
    stop();
  }
}
`;

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [code, setCode] = useState<string>(STARTER_CODE);
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

        EventBus.on('code-started', onCodeStarted);
        EventBus.on('code-stopped', onCodeStopped);
        EventBus.on('code-error', onCodeError);

        return () => {
            EventBus.removeListener('code-started', onCodeStarted);
            EventBus.removeListener('code-stopped', onCodeStopped);
            EventBus.removeListener('code-error', onCodeError);
        };
    }, []);

    // Send code execution request to the Phaser scene
    const handleRun = () => {
        setErrorMessage(null);
        EventBus.emit('run-code', code);
    };

    // Send stop request to the Phaser scene
    const handleStop = () => {
        EventBus.emit('stop-code');
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
                        className={`button ${isRunning ? 'btn-stop' : 'btn-run'}`}
                        onClick={isRunning ? handleStop : handleRun}
                    >
                        {isRunning ? '⏹ Stop' : '▶ Run'}
                    </button>
                    <span className={`status-text ${isRunning ? 'running' : ''}`}>
                        {isRunning ? '● Running' : '○ Stopped'}
                    </span>
                </div>

                <div className="editor-content">
                    <Editor
                        defaultValue={STARTER_CODE}
                        onChange={setCode}
                    />
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
