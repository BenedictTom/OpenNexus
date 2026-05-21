// SSE 广播 - 让浏览器/APK 实时看到会话变化、审批状态等

type Subscriber = (data: string) => void;

const subs = new Set<Subscriber>();

export const subscribe = (cb: Subscriber): (() => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
};

export const broadcast = (event: object): void => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const cb of subs) {
        try { cb(line); } catch { /* ignore */ }
    }
};

// 构造 SSE Response,持续推
export const sseResponse = (): Response => {
    let unsub: (() => void) | null = null;
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const send = (line: string) => {
                try { controller.enqueue(encoder.encode(line)); }
                catch { unsub?.(); }
            };
            // 初始 hello
            send(`: hello ${Date.now()}\n\n`);
            unsub = subscribe(send);

            // 心跳
            const hb = setInterval(() => send(`: hb ${Date.now()}\n\n`), 15000);
            (controller as any)._hb = hb;
        },
        cancel() {
            unsub?.();
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        },
    });
};
