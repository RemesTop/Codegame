import { useEffect, useRef, useState } from 'react';

const PLAYER_ASSET_BASE = `${import.meta.env.BASE_URL}assets/Player`;

interface MainMenuProps {
    onOpenLevelSelect: () => void;
    onOpenInstructions: () => void;
}

function MainMenu({
    onOpenLevelSelect,
    onOpenInstructions,
}: MainMenuProps) {
    const [showComingSoon, setShowComingSoon] = useState(false);
    const tooltipTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (tooltipTimerRef.current !== null) {
                window.clearTimeout(tooltipTimerRef.current);
            }
        };
    }, []);

    const handleLeaderboardClick = () => {
        setShowComingSoon(true);
        if (tooltipTimerRef.current !== null) {
            window.clearTimeout(tooltipTimerRef.current);
        }
        tooltipTimerRef.current = window.setTimeout(() => {
            setShowComingSoon(false);
            tooltipTimerRef.current = null;
        }, 1800);
    };
    return (
        <main className="main-menu-page">
            <h1 className="main-menu-title">Fine! You make it!</h1>
            <svg
                className="main-menu-logo"
                viewBox="12 0 90 140"
                role="img"
                aria-label="Codegame robot character"
            >
                {/* Back arm */}
                <g transform="translate(73, 74)">
                    <g className="menu-robot-back-arm">
                        <image
                            href={`${PLAYER_ASSET_BASE}/arm2_high.png`}
                            x={-12.75}
                            y={-4.8}
                            width={17}
                            height={24}
                        />
                        <g transform="translate(-7, 14)">
                            <g className="menu-robot-back-forearm">
                                <image
                                    href={`${PLAYER_ASSET_BASE}/arm2_low.png`}
                                    x={-5.5}
                                    y={-4.8}
                                    width={25}
                                    height={24}
                                />
                            </g>
                        </g>
                    </g>
                </g>

                {/* Legs (planted on ground, layered behind core) */}
                <image
                    href={`${PLAYER_ASSET_BASE}/leg_back.png`}
                    x={51.3}
                    y={92.75}
                    width={26}
                    height={35}
                />
                <image
                    href={`${PLAYER_ASSET_BASE}/leg_front.png`}
                    x={37.3}
                    y={90.85}
                    width={26}
                    height={41}
                />

                {/* Upper body (torso, head, front arm) */}
                <g className="menu-robot-upper">
                    <image
                        href={`${PLAYER_ASSET_BASE}/character_core.png`}
                        x={35}
                        y={52}
                        width={40}
                        height={52}
                    />
                    <g transform="translate(57, 66)">
                        <g className="menu-robot-head">
                            <image
                                href={`${PLAYER_ASSET_BASE}/character_head.png`}
                                x={-32}
                                y={-56.32}
                                width={64}
                                height={64}
                            />
                        </g>
                    </g>

                    {/* Front arm (forearm behind upper-arm elbow cap) */}
                    <g transform="translate(45, 78)">
                        <g className="menu-robot-front-arm">
                            <g transform="translate(-9, 14)">
                                <g className="menu-robot-front-forearm">
                                    <image
                                        href={`${PLAYER_ASSET_BASE}/arm1_low.png`}
                                        x={-5.28}
                                        y={-5.4}
                                        width={24}
                                        height={27}
                                    />
                                </g>
                            </g>
                            <image
                                href={`${PLAYER_ASSET_BASE}/arm1_high.png`}
                                x={-15}
                                y={-5}
                                width={20}
                                height={25}
                            />
                        </g>
                    </g>
                </g>
            </svg>
            <div className="main-menu-buttons">
                <div className="menu-button-grid">
                    <button
                        className="main-menu-button"
                        onClick={onOpenLevelSelect}
                    >
                        Level Select
                    </button>
                    <div className="main-menu-tooltip-wrap">
                        <button
                            className="main-menu-button main-menu-button-disabled"
                            aria-disabled="true"
                            onClick={handleLeaderboardClick}
                        >
                            Leaderboard
                        </button>
                        {showComingSoon && (
                            <span className="main-menu-tooltip" role="status">
                                coming soon™
                            </span>
                        )}
                    </div>
                    <button
                        className="main-menu-button"
                        onClick={onOpenInstructions}
                    >
                        Instructions
                    </button>
                </div>
            </div>
        </main>
    );
}

export default MainMenu;
