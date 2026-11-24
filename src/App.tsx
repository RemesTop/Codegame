import { useEffect, useRef, useState } from 'react';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { Editor } from './Editor';
import { Instructions } from './Instructions';
import { LevelSelect } from './LevelSelect';
import MainMenu from './MainMenu';
import { EventBus } from './game/EventBus';
import {
    AppPage,
    getLevelDefinition,
    getLevelIdFromUrl,
    getPageFromUrl,
    LEVELS,
    setLevelIdInUrl,
} from './game/Levels/levels';
import { useBestTime, useSavedCode } from './storage';

function formatElapsedTime(ms: number): string {
    const clampedMs = Math.max(0, Math.floor(ms));
    const totalSeconds = Math.floor(clampedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((clampedMs % 1000) / 10);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const runStartTimeRef = useRef<number | null>(null);
    const lastRunMsRef = useRef<number>(0);
    const levelSelectReturnPageRef = useRef<'menu' | 'game'>('menu');
    const [page, setPage] = useState<AppPage>(() => getPageFromUrl());
    const [currentLevelId, setCurrentLevelId] = useState<number>(() =>
        getLevelIdFromUrl(),
    );
    const currentLevelIdRef = useRef<number>(currentLevelId);
    currentLevelIdRef.current = currentLevelId;

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
    const [bestTimeMs, recordBestTime] = useBestTime(currentLevelId);
    const recordBestTimeRef = useRef(recordBestTime);
    recordBestTimeRef.current = recordBestTime;

    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [elapsedMs, setElapsedMs] = useState<number>(0);
    const [isLevelComplete, setIsLevelComplete] = useState<boolean>(false);
    const [isNewBestTime, setIsNewBestTime] = useState<boolean>(false);
    const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    // --- Update run timer while code is executing ---
    useEffect(() => {
        if (!isRunning || isPaused) return;

        const startTime =
            runStartTimeRef.current ?? Date.now() - lastRunMsRef.current;
        runStartTimeRef.current = startTime;

        const intervalId = window.setInterval(() => {
            setElapsedMs(Date.now() - startTime);
        }, 30);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isRunning, isPaused]);

    // --- Sync URL ?level=<id>&page=<page> on initial mount and browser Back/Forward ---
    useEffect(() => {
        setLevelIdInUrl(getLevelIdFromUrl(), true, getPageFromUrl());

        const onPopState = () => {
            const urlLevelId = getLevelIdFromUrl();
            const urlPage = getPageFromUrl();
            runStartTimeRef.current = null;
            setElapsedMs(0);
            setCurrentLevelId(urlLevelId);
            setPage(urlPage);
            setIsMenuOpen(false);
            setIsPaused(false);
            setIsLevelComplete(false);
            setIsNewBestTime(false);
            setErrorMessage(null);
            EventBus.emit('load-level', urlLevelId);
        };

        window.addEventListener('popstate', onPopState);
        return () => {
            window.removeEventListener('popstate', onPopState);
        };
    }, []);

    // --- Listen to Phaser scene events via EventBus ---
    useEffect(() => {
        const freezeTimer = () => {
            if (runStartTimeRef.current !== null) {
                const finalMs = Date.now() - runStartTimeRef.current;
                lastRunMsRef.current = finalMs;
                setElapsedMs(finalMs);
                runStartTimeRef.current = null;
            }
        };

        const onCodeStarted = () => {
            runStartTimeRef.current = Date.now();
            lastRunMsRef.current = 0;
            setElapsedMs(0);
            setIsNewBestTime(false);
            setIsRunning(true);
            setIsPaused(false);
            setErrorMessage(null);
        };

        const onCodeStopped = () => {
            freezeTimer();
            setIsRunning(false);
            setIsPaused(false);
        };

        const onCodeError = (errorMsg: string) => {
            freezeTimer();
            setIsRunning(false);
            setIsPaused(false);
            setErrorMessage(errorMsg);
        };

        const onLevelComplete = (completedLevelId?: number) => {
            freezeTimer();
            const targetLevelId =
                typeof completedLevelId === 'number'
                    ? completedLevelId
                    : currentLevelIdRef.current;
            const isNewBest = recordBestTimeRef.current(
                targetLevelId,
                lastRunMsRef.current,
            );
            setIsNewBestTime(isNewBest);
            setIsRunning(false);
            setIsPaused(false);
            setIsLevelComplete(true);
        };

        EventBus.on('code-started', onCodeStarted);
        EventBus.on('code-stopped', onCodeStopped);
        EventBus.on('code-error', onCodeError);
        EventBus.on('level-complete', onLevelComplete);

        return () => {
            EventBus.removeListener('code-started', onCodeStarted);
            EventBus.removeListener('code-stopped', onCodeStopped);
            EventBus.removeListener('code-error', onCodeError);
            EventBus.removeListener('level-complete', onLevelComplete);
        };
    }, []);

    // Send code execution request to the Phaser scene
    const handleRun = () => {
        if (isPaused) return;
        setErrorMessage(null);
        setIsLevelComplete(false);
        setIsPaused(false);
        EventBus.emit('run-code', code);
    };

    // Send stop request to the Phaser scene
    const handleStop = () => {
        setIsLevelComplete(false);
        setIsPaused(false);
        EventBus.emit('stop-code');
    };

    // Reset current level simulation back to spawn
    const handleRestartLevel = () => {
        runStartTimeRef.current = null;
        setElapsedMs(0);
        setIsPaused(false);
        setIsLevelComplete(false);
        setErrorMessage(null);
        EventBus.emit('stop-code');
    };

    // Switch to the next level and load its own saved code
    const handleNextLevel = () => {
        if (!nextLevel) return;
        runStartTimeRef.current = null;
        setElapsedMs(0);
        setIsPaused(false);
        setIsLevelComplete(false);
        setErrorMessage(null);
        setCurrentLevelId(nextLevel.id);
        setLevelIdInUrl(nextLevel.id, false, 'game');
        EventBus.emit('load-level', nextLevel.id);
    };

    const handleOpenLevelSelect = (returnPage: 'menu' | 'game') => {
        levelSelectReturnPageRef.current = returnPage;
        EventBus.emit('stop-code');
        runStartTimeRef.current = null;
        setElapsedMs(0);
        setIsMenuOpen(false);
        setIsPaused(false);
        setIsLevelComplete(false);
        setErrorMessage(null);
        setPage('levels');
        setLevelIdInUrl(currentLevelId, false, 'levels');
    };

    const handleOpenInstructions = () => {
        setPage('instructions');
        setLevelIdInUrl(currentLevelId, false, 'instructions');
    };

    const handleBackFromInstructions = () => {
        setPage('menu');
        setLevelIdInUrl(currentLevelId, false, 'menu');
    };

    const handleSelectLevel = (levelId: number) => {
        runStartTimeRef.current = null;
        setElapsedMs(0);
        setIsMenuOpen(false);
        setIsPaused(false);
        setIsLevelComplete(false);
        setErrorMessage(null);
        setCurrentLevelId(levelId);
        setPage('game');
        setLevelIdInUrl(levelId, false, 'game');
        EventBus.emit('load-level', levelId);
    };

    const handleBackFromLevelSelect = () => {
        const returnPage = levelSelectReturnPageRef.current;
        setPage(returnPage);
        setIsPaused(false);
        setLevelIdInUrl(currentLevelId, false, returnPage);
    };

    const handleOpenMainMenu = () => {
        EventBus.emit('stop-code');
        runStartTimeRef.current = null;
        setElapsedMs(0);
        setIsMenuOpen(false);
        setIsPaused(false);
        setIsLevelComplete(false);
        setErrorMessage(null);
        setPage('menu');
        setLevelIdInUrl(currentLevelId, false, 'menu');
    };

    const pauseGame = () => {
        if (isPaused) return;
        if (runStartTimeRef.current !== null) {
            lastRunMsRef.current = Date.now() - runStartTimeRef.current;
            setElapsedMs(lastRunMsRef.current);
            runStartTimeRef.current = null;
        }
        EventBus.emit('pause-code');
        setIsPaused(true);
        setIsMenuOpen(true);
    };

    const resumeGame = () => {
        if (!isPaused) {
            setIsMenuOpen(false);
            return;
        }
        EventBus.emit('resume-code');
        setIsPaused(false);
        setIsMenuOpen(false);
    };

    return (
        <>
            {page === 'menu' && (
                <MainMenu
                    onOpenLevelSelect={() => handleOpenLevelSelect('menu')}
                    onOpenInstructions={handleOpenInstructions}
                />
            )}

            {page === 'instructions' && (
                <Instructions onBack={handleBackFromInstructions} />
            )}

            {page === 'levels' && (
                <LevelSelect
                    levels={LEVELS}
                    currentLevelId={currentLevelId}
                    onSelectLevel={handleSelectLevel}
                    onBack={handleBackFromLevelSelect}
                />
            )}

            <div
                id="app"
                style={{ display: page === 'game' ? 'flex' : 'none' }}
            >
                {/* Left side: Phaser Game Viewport */}
                <div className="game-view">
                    <div className="game-stage">
                        <PhaserGame ref={phaserRef} />
                        {isLevelComplete && (
                            <div className="modal-overlay">
                                <div className="modal level-complete-modal">
                                    <h2>YOU MADE IT!</h2>
                                    <h3 className="level-complete-level">
                                        {currentLevel.name.toUpperCase()}
                                    </h3>
                                    <div className="level-complete-times">
                                        <p>
                                            Time: {formatElapsedTime(elapsedMs)}
                                        </p>
                                        {isNewBestTime && (
                                            <p className="level-complete-best">
                                                New best time!
                                            </p>
                                        )}
                                    </div>
                                    <div className="modal-actions level-complete-actions">
                                        <button
                                            className="button btn-secondary"
                                            onClick={handleRestartLevel}
                                        >
                                            Play again
                                        </button>
                                        <button
                                            className="button btn-run"
                                            onClick={handleNextLevel}
                                            disabled={!nextLevel}
                                        >
                                            {nextLevel
                                                ? `Go to ${nextLevel.name}`
                                                : 'All Levels Complete'}
                                        </button>
                                        <button
                                            className="button btn-secondary"
                                            onClick={handleOpenMainMenu}
                                        >
                                            Main menu
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        {isMenuOpen && (
                            <div className="modal-overlay" onClick={resumeGame}>
                                <div
                                    className="modal menu-modal"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <h2>Pause</h2>
                                    <p className="menu-best-time">
                                        Best time:{' '}
                                        {bestTimeMs !== null
                                            ? formatElapsedTime(bestTimeMs)
                                            : '--:--.--'}
                                    </p>
                                    <div className="menu-actions">
                                        <button
                                            className="button btn-run"
                                            onClick={resumeGame}
                                        >
                                            Resume
                                        </button>
                                        <button
                                            className="button btn-secondary"
                                            onClick={() =>
                                                handleOpenLevelSelect('game')
                                            }
                                        >
                                            Level select
                                        </button>
                                        <button
                                            className="button btn-secondary"
                                            onClick={handleOpenMainMenu}
                                        >
                                            Main menu
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="game-footer">
                        <span className="game-footer-level">
                            {currentLevel.name}
                        </span>
                        <button
                            className="button btn-secondary"
                            onClick={isMenuOpen ? resumeGame : pauseGame}
                        >
                            {isPaused ? 'Resume' : 'Pause'}
                        </button>
                    </div>
                </div>

                {/* Right side: Code Editor & Controls */}
                <div className="editor-view">
                    <div className="editor-toolbar">
                        <button
                            className={`button ${isRunning ? 'btn-stop' : 'btn-run'}`}
                            onClick={isRunning ? handleStop : handleRun}
                            disabled={!isRunning && isPaused}
                        >
                            {isRunning ? '⏹ Stop' : '▶ Run'}
                        </button>
                        <span
                            className={`status-text ${isRunning ? 'running' : ''}`}
                        >
                            {isRunning ? '● Running' : '○ Stopped'}
                        </span>
                        <span className="toolbar-timer">
                            {formatElapsedTime(elapsedMs)}
                        </span>
                        <button
                            className="button btn-reset"
                            onClick={() => setShowConfirm(true)}
                            disabled={isRunning}
                            aria-label="Reset code"
                            title="Reset code"
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                                <path d="M3 3v5h5" />
                            </svg>
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
                                        Are you sure you want to reset the
                                        editor back to the starter code?
                                    </p>
                                    <div className="modal-actions">
                                        <button
                                            className="button"
                                            onClick={() =>
                                                setShowConfirm(false)
                                            }
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="button btn-stop"
                                            onClick={() => {
                                                setCode(
                                                    currentLevel.starterCode,
                                                );
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
        </>
    );
}

export default App;
