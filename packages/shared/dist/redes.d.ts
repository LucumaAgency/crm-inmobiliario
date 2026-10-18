/**
 * Redes sociales de un contacto. Se guardan tal como se escriben (usuario «@marca» o enlace) y
 * se convierten en enlace al mostrarlas.
 */
export declare const REDES: readonly [{
    readonly campo: "instagram";
    readonly nombre: "Instagram";
    readonly base: "https://instagram.com/";
    readonly ejemplo: "@usuario";
}, {
    readonly campo: "facebook";
    readonly nombre: "Facebook";
    readonly base: "https://facebook.com/";
    readonly ejemplo: "facebook.com/pagina";
}, {
    readonly campo: "tiktok";
    readonly nombre: "TikTok";
    readonly base: "https://tiktok.com/@";
    readonly ejemplo: "@usuario";
}, {
    readonly campo: "linkedin";
    readonly nombre: "LinkedIn";
    readonly base: "https://linkedin.com/in/";
    readonly ejemplo: "linkedin.com/in/usuario";
}, {
    readonly campo: "website";
    readonly nombre: "Página web";
    readonly base: "https://";
    readonly ejemplo: "empresa.com";
}];
export type CampoRed = (typeof REDES)[number]['campo'];
/** «@marca», «marca» o un enlace → enlace navegable. Null si está vacío. */
export declare function enlaceRed(campo: CampoRed, valor: string | null | undefined): string | null;
