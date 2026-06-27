export default function replaceUrl(url: string): string {
    if (typeof url !== 'string' || !url.trim()) return '';
    let cleanedPath = '';
    try {
        const pathname = new URL(url).pathname;
        cleanedPath = pathname.replace(/^\/oss/, '');
    } catch (e) {
        // 如果不是有效的URL，则直接返回原字符串
        cleanedPath = url;
    }
    return cleanedPath;
}
