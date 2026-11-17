import { useEffect, useState } from "react";

export function useSavedCode(levelId: number, starterCode: string) {
    const key = `editor-code-lvl-${levelId}`;

    const [code, setCode] = useState<string>(() => {
        try {
            return localStorage.getItem(key) ?? starterCode;
        } catch {
            return starterCode;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, code); // saving editor code to localStorage on change
        } catch {
            // silent fail when can't save to localstorage
        }
    }, [key, code]);

    return [code, setCode] as const;
}

