import { useCallback, useEffect, useState } from "react";

function readSavedCode(key: string, starterCode: string): string {
    try {
        return localStorage.getItem(key) ?? starterCode;
    } catch {
        return starterCode;
    }
}

export function useSavedCode(levelId: number, starterCode: string) {
    const key = `editor-code-lvl-${levelId}`;

    const [state, setState] = useState<{ key: string; code: string }>(() => ({
        key,
        code: readSavedCode(key, starterCode),
    }));

    const activeCode =
        state.key === key ? state.code : readSavedCode(key, starterCode);

    // Sync state when switching levels so we never overwrite the new level with the previous level's code
    useEffect(() => {
        if (state.key !== key) {
            setState({
                key,
                code: readSavedCode(key, starterCode),
            });
        }
    }, [key, starterCode, state.key]);

    useEffect(() => {
        if (state.key !== key) return;
        try {
            localStorage.setItem(key, state.code); // saving editor code to localStorage on change
        } catch {
            // silent fail when can't save to localstorage
        }
    }, [key, state]);

    const setCode = useCallback(
        (nextCode: string) => {
            setState({ key, code: nextCode });
        },
        [key],
    );

    return [activeCode, setCode] as const;
}

function bestTimeKey(levelId: number): string {
    return `best-time-lvl-${levelId}`;
}

function readBestTime(levelId: number): number | null {
    try {
        const raw = localStorage.getItem(bestTimeKey(levelId));
        if (raw === null) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    } catch {
        return null;
    }
}

export function useBestTime(levelId: number) {
    const [state, setState] = useState<{
        levelId: number;
        bestMs: number | null;
    }>(() => ({
        levelId,
        bestMs: readBestTime(levelId),
    }));

    const activeBestMs =
        state.levelId === levelId ? state.bestMs : readBestTime(levelId);

    useEffect(() => {
        if (state.levelId !== levelId) {
            setState({
                levelId,
                bestMs: readBestTime(levelId),
            });
        }
    }, [levelId, state.levelId]);

    const recordBestTime = useCallback(
        (completedLevelId: number, timeMs: number) => {
            const safeMs = Math.max(0, Math.floor(timeMs));
            const existing = readBestTime(completedLevelId);
            if (existing !== null && safeMs >= existing) {
                return;
            }
            try {
                localStorage.setItem(
                    bestTimeKey(completedLevelId),
                    String(safeMs),
                );
            } catch {
                // silent fail when can't save to localstorage
            }
            if (completedLevelId === levelId) {
                setState({ levelId: completedLevelId, bestMs: safeMs });
            }
        },
        [levelId],
    );

    return [activeBestMs, recordBestTime] as const;
}

