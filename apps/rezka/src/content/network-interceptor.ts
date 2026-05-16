(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args: any[]) {
        const response = await originalFetch.apply(window, args as [RequestInfo | URL, RequestInit?]);
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url && url.includes('.vtt')) {
            window.postMessage({ type: 'VTT_URL_DETECTED', url }, '*');
        }
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(this: XMLHttpRequest, ...args: any[]) {
        const url = args[1];
        if (typeof url === 'string' && url.includes('.vtt')) {
            window.postMessage({ type: 'VTT_URL_DETECTED', url }, '*');
        }
        return (originalOpen as any).apply(this, args);
    };
})();
