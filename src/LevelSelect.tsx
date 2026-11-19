import { LevelDefinition } from "./game/Levels/levels";

interface LevelSelectProps {
    levels: LevelDefinition[];
    currentLevelId: number;
    onSelectLevel: (levelId: number) => void;
    onBack: () => void;
}

export function LevelSelect({
    levels,
    currentLevelId,
    onSelectLevel,
    onBack,
}: LevelSelectProps) {
    return (
        <div className="level-select-page">
            <div className="level-select-header">
                <button className="button btn-secondary" onClick={onBack}>
                    ← Back
                </button>
            </div>

            <div className="level-select-content">
                <h1>Select Level</h1>

                <div className="level-select-grid">
                    {levels.map((level) => (
                        <button
                            key={level.id}
                            className={`level-card ${
                                level.id === currentLevelId ? "active" : ""
                            }`}
                            onClick={() => onSelectLevel(level.id)}
                        >
                            <span className="level-card-number">{level.id}</span>
                            <span className="level-card-name">{level.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
