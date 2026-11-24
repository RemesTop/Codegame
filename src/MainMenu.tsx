interface MainMenuProps {
    onOpenLevelSelect: () => void;
    onOpenInstructions: () => void;
}

function MainMenu({
    onOpenLevelSelect,
    onOpenInstructions,
}: MainMenuProps) {
    return (
        <main className="main-menu-page">
            <h1 className="main-menu-title">Fine! You make it!</h1>
            <img
                className="main-menu-logo"
                src="/favicon.png"
                alt="Codegame logo"
            />
            <div className="main-menu-buttons">
                <div className="menu-button-grid">
                    <button
                        className="main-menu-button"
                        onClick={onOpenLevelSelect}
                    >
                        Level Select
                    </button>
                    <button
                        className="main-menu-button"
                        onClick={onOpenLevelSelect}
                    >
                        Leaderboard
                    </button>
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
