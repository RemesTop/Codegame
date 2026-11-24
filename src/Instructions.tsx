interface InstructionsProps {
    onBack: () => void;
}

export function Instructions({ onBack }: InstructionsProps) {
    return (
        <main className="instructions-page">
            <button
                className="button btn-secondary instructions-back"
                onClick={onBack}
            >
                ← Back
            </button>
            <h1 className="instructions-title">Instructions</h1>

            <div className="instructions-panels">
                <section className="instructions-panel">
                    <h2>How to play</h2>
                    <ul>
                        <li>
                            Move the robot from the start to the finish line by
                            writing javascript.
                        </li>
                        <li>
                            Try to minimize the time it takes to finish from the
                            moment you press start.
                        </li>
                        <li>
                            <code>track()</code> can be used to show the values
                            of variables on the screen.
                        </li>
                    </ul>
                    <p>
                        Put the setup code into <code>start()</code>, it only
                        runs once. Repeating actions should be put into{' '}
                        <code>update()</code>, it loops as long as it takes to
                        finish the level.
                    </p>
                </section>

                <section className="instructions-panel">
                    <h2>Robot commands</h2>
                    <ul>
                        <li>
                            <code>moveRight()</code> makes the robot move right
                            until otherwise stated.
                        </li>
                        <li>
                            <code>moveLeft()</code> makes the robot move left
                            until otherwise stated.
                        </li>
                        <li>
                            <code>stop()</code> makes the robot stop in place.
                        </li>
                        <li>
                            <code>jump()</code> makes the robot jump if it is
                            standing on a solid object.
                        </li>
                        <li>
                            <code>Detect(angle, target, maxDistance)</code>{' '}
                            looks into the given angle to the maxDistance and
                            returns whether it found the target (ground, others
                            added later?).
                        </li>
                    </ul>
                    <p>Written code is saved for each level on the browser.</p>
                </section>
            </div>
        </main>
    );
}
