# Salto Postal

Plataformas 2D en línea para 2–4 personas. El escenario ocupa toda la ventana, incluido el menú, y el botón de expandir activa la pantalla completa del navegador.

## Cómo funciona una ronda

1. **Selección.** La caja ofrece hasta ocho piezas de un catálogo de 18. Todos pueden elegir a la vez y la primera solicitud que recibe el anfitrión se queda con la pieza.
2. **Construcción.** Todos colocan a la vez. En una pantalla táctil, mueve la vista previa y pulsa **Colocar**. El borde izquierdo permite que sobresalgan hasta 12 píxeles del escenario. Si dos jugadores intentan ocupar el mismo sitio, se reserva para la primera colocación válida. El resto de la cuadrilla ve el contorno de tu pieza mientras la mueves.
3. **Carrera.** Salta entre plataformas y entra en el escáner verde. Recoge la moneda dorada de la pista si quieres optar al bono de estilo. En línea desaparece de tu pantalla al recogerla y sigue disponible para tus rivales.
4. **Resultados.** Cada celda representa un punto. Los colores conservan el origen de los puntos acumulados y las celdas de la ronda se iluminan al llegar. El podio aparece al alcanzar la meta de puntos o el límite de rondas de la sala.

La partida usa por defecto un máximo de 15 rondas, una limpieza de objetos cada 5 y una meta de 15 puntos. La caja se abre durante un máximo de 13 segundos y la carrera dura hasta 30 segundos. En **Ajustes de partida**, el anfitrión puede cambiar esos tiempos, los límites, la potencia de salto, la velocidad y la aparición de cada pieza. También se limpian los objetos si todos los jugadores conectados votan a favor.

La **Papelera** retira cualquier pieza colocada durante la partida, incluidas las plataformas, los mecanismos y las trampas. Las piezas originales de la pista quedan protegidas. Apunta a una pieza y confirma. En táctil, el botón se llama **Borrar**.

| Acción | Puntos |
| --- | ---: |
| Entregar cuando solo parte de la cuadrilla llega | +3 |
| Ser el primero en entregar | +1 |
| Eliminar a un rival con una trampa tuya | +1 por rival |
| Entregar tras recoger el sello dorado | +1 |

Si todos entregan, se omiten los 3 puntos de entrega. Se mantienen el punto de primer puesto y los bonos de trampa y estilo.

## Pistas y piezas

Hay doce pistas: Dársena 07, Azotea Iris, Canal Neón, Fundición Ámbar, Antenas Boreales, Terminal Espejo, Archivo Submarino, Jardín de Bobinas, Vía de Mercurio, Oasis de Cristal, Cámara Antigravedad y Salinas del Ocaso. Cámara Antigravedad tiene saltos más largos.

- **Trampas.** Púas, rotor, prensa, emisor de chispas, sierra vertical, rayo, mina de pulso, bobina eléctrica, péndulo y púas retráctiles.
- **Plataformas y mecanismos.** Viga, muelle, transbordador, plataforma frágil, hielo, cinta y gel denso.
- **Superficies.** El gel denso reduce la velocidad y el salto. El hielo conserva brevemente la dirección del movimiento al aterrizar.
- **Orientación.** Puedes girar el emisor, el rayo y la cinta antes de colocarlos.
- **Emisores.** Puedes tocar las carcasas. El rayo activo y las chispas son los que eliminan.

## Jugar

- **En línea.** El anfitrión comparte el enlace de la sala o el código de seis caracteres. El enlace abre el juego en la misma dirección y rellena el código. Dentro de la Estación de reparto, cada persona elige su animal, su complemento y el mapa que prefiere. El anfitrión puede empezar cuando todos marcan **Listo**. Se juega el mapa más votado. Si hay empate, se usa el voto del anfitrión si está entre los empatados. Si nadie vota, se usa la pista anterior.
- **Conexión manual.** Si la señalización automática falla, selecciona **Conexión manual**. El anfitrión genera una invitación WebRTC por invitado. Cada invitado devuelve su respuesta para confirmar la conexión.
- **Carrera.** Corre con A/D o las flechas. Salta con W, ↑ o espacio. En móviles y tablets, abre **Táctil** para elegir flechas o joystick. Puedes moverte y pulsar **Saltar** con otro dedo.
- **Construcción táctil.** Toca o arrastra sobre el mapa para ajustar la vista previa. También puedes usar el mando elegido. Pulsa **Colocar** para confirmar. El juego recuerda el mando en ese navegador.
- **Construcción con teclado.** Usa WASD o flechas y confirma con E o Enter.

## Mapas personalizados

Abre **Creador de mapas** en el menú. Puedes empezar en blanco, copiar una pista del juego o abrir un JSON exportado. Coloca plataformas con un clic o arrastra para definir su ancho. También puedes mover la salida, la meta y el sello, y elegir el fondo y la gravedad. Usa **Descargar mapa** para guardar el JSON y compartirlo.

El anfitrión abre **Cargar mapa** en el lobby privado y selecciona el JSON. El mapa se comparte automáticamente con toda la sala. Desde ese mismo panel puedes editar la pista o quitarla para volver a la votación. En el editor abierto desde el lobby, **Usar en esta sala** aplica el mapa directamente.
