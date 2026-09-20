/**
 * Partir un nombre completo en nombres y apellidos, a la peruana.
 *
 * Hace falta siempre que un canal entrega el nombre en un solo campo: el `full_name` de
 * un formulario instantáneo de Meta, el nombre del perfil de WhatsApp. Cortar por el
 * primer espacio es lo obvio y es lo incorrecto aquí: «María Elena Rojas Paz» quedaría
 * como «María» de nombre y «Elena Rojas Paz» de apellido, y el asesor la saluda mal en el
 * primer mensaje.
 *
 * En Perú se usan dos apellidos, así que desde tres palabras las dos últimas son los
 * apellidos y lo anterior son los nombres. Con dos palabras, uno y uno. No es infalible
 * —hay apellidos compuestos como «De la Cruz»—, pero acierta en la enorme mayoría y falla
 * mejor: deja el nombre de pila correcto, que es lo que se usa para saludar.
 */
export declare function partirNombre(completo: string): {
    fname: string;
    lname?: string;
};
