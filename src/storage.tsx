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

