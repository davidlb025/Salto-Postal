# Salto Postal

Plataformas 2D en línea para 2–4 personas. El escenario ocupa toda la ventana. En **Opciones → Pantalla completa** puedes ampliar el juego al tamaño de la pantalla.

## Cómo funciona una ronda

1. **Selección.** La caja ofrece hasta ocho piezas de un catálogo de 18. Todos pueden elegir a la vez y la primera solicitud que recibe el anfitrión se queda con la pieza.
2. **Construcción.** Todos colocan a la vez. En una pantalla táctil, mueve la vista previa y pulsa **Colocar**. El borde izquierdo permite que sobresalgan hasta 12 píxeles del escenario. Si dos jugadores intentan ocupar el mismo sitio, se reserva para la primera colocación válida. El resto de la cuadrilla ve el contorno de tu pieza mientras la mueves.
3. **Carrera.** Salta entre plataformas y entra en el escáner verde. El sello dorado se recoge por jugador y vale puntos al entregar en la misma ronda.
4. **Resultados.** Cada celda representa un punto. Los colores conservan el origen de los puntos acumulados y las celdas de la ronda se iluminan al llegar. El podio aparece al alcanzar la meta de puntos o el límite de rondas de la sala.

La partida usa por defecto un máximo de 15 rondas, una limpieza de objetos cada 5 y una meta de 15 puntos. La caja se abre durante un máximo de 13 segundos y la carrera dura hasta 30 segundos. Todos pueden consultar **Ajustes de partida** en el panel de la sala. El anfitrión puede editar los tiempos, los límites, la potencia de salto, la velocidad, la aparición de cada pieza y el valor de la entrega, el primer puesto y el sello. También se limpian los objetos si todos los jugadores conectados votan a favor.

La **Papelera** retira cualquier pieza colocada durante la partida, incluidas las plataformas, los mecanismos y las trampas. Las piezas originales de la pista quedan protegidas. Apunta a una pieza y confirma. En táctil, el botón se llama **Borrar**.

| Acción | Puntos por defecto |
| --- | ---: |
| Entregar si algún rival cae o agota el tiempo | +3 |
| Llegar en el primer paso de simulación con entregas | +1 para cada primero |
| Eliminar a un rival con una trampa tuya | +1 por rival, hasta 2 si hay entregas y hasta 1 si nadie entrega |
| Entregar tras recoger el sello dorado | +1 |

En **Ajustes de partida** puedes desactivar la condición de entrega para dar puntos a todos los que entreguen en una ronda válida. También puedes cambiar los puntos por rival eliminado con una trampa propia y fijar por separado los topes por jugador y ronda con entregas y sin entregas.

Las llegadas en el mismo paso de simulación comparten puesto. Si una trampa y la meta coinciden para un corredor en el mismo paso, cuenta la eliminación. El anfitrión cierra el marcador después del último paso válido. Si hay empate en cabeza al terminar la partida, el podio conserva el empate.

Si un corredor se desconecta tras la salida, conserva sus entregas, eliminaciones y créditos de trampa confirmados. Con la condición de entrega activa, un abandono por sí solo no da derecho al bono. Con menos de dos resultados competitivos, la ronda se cancela y el marcador y el contador de rondas se conservan. Si quedan menos de dos jugadores conectados, la sala vuelve al lobby tras mostrar los resultados o presenta el podio si la partida ya terminó.

## Pistas y piezas

Hay doce pistas: Dársena 07, Azotea Iris, Canal Neón, Fundición Ámbar, Antenas Boreales, Terminal Espejo, Archivo Submarino, Jardín de Bobinas, Vía de Mercurio, Oasis de Cristal, Cámara Antigravedad y Salinas del Ocaso. Cámara Antigravedad tiene saltos más largos.

- **Trampas.** Púas, rotor, prensa, emisor de chispas, sierra vertical, rayo, mina de pulso, bobina eléctrica, péndulo y púas retráctiles.
- **Plataformas y mecanismos.** Viga, muelle, transbordador, plataforma frágil, hielo, cinta y gel denso.
- **Superficies.** El gel denso reduce la velocidad y el salto. El hielo conserva brevemente la dirección del movimiento al aterrizar.
- **Orientación.** Puedes girar el emisor, el rayo y la cinta antes de colocarlos.
- **Emisores.** Puedes tocar las carcasas. El rayo activo y las chispas son los que eliminan.

## Jugar

- **En línea.** El anfitrión comparte el enlace de la sala o el código de seis caracteres. El enlace abre el juego en la misma dirección y rellena el código. Dentro de la Estación de reparto, cada persona elige su animal, su complemento y el mapa que prefiere. El anfitrión puede empezar cuando todos marcan **Listo**. Se juega el mapa más votado. Si hay empate, se usa el voto del anfitrión si está entre los empatados. Todos empiezan con **Aleatorio** seleccionado. Si gana esa opción, el anfitrión sortea una de las doce pistas al comenzar la partida.
- **Conexión manual.** Si la señalización automática falla, selecciona **Conexión manual**. El anfitrión genera una invitación WebRTC por invitado. Cada invitado devuelve su respuesta para confirmar la conexión.
- **Carrera.** Corre con A/D o las flechas. Salta con W, ↑ o espacio. En móviles y tablets, abre **Opciones → Controles táctiles** para elegir flechas o joystick. Puedes moverte y pulsar **Saltar** con otro dedo.
- **Construcción táctil.** Toca o arrastra sobre el mapa para ajustar la vista previa. También puedes usar el mando elegido. Pulsa **Colocar** para confirmar. El juego recuerda el mando en ese navegador.
- **Construcción con teclado.** Usa WASD o flechas y confirma con E o Enter.

## Mapas personalizados

Abre **Creador de mapas** en el menú. Puedes empezar en blanco, copiar una pista del juego o abrir un JSON exportado. Coloca plataformas con un clic o arrastra para definir su ancho. También puedes mover la salida, la meta y el sello, y elegir el fondo y la gravedad. Usa **Descargar mapa** para guardar el JSON y compartirlo.

Pulsa **Probar mapa** para correr desde la salida real del borrador. **Reiniciar** o **R** te devuelven a la salida. Con **Montar piezas** puedes preparar un recorrido temporal y probarlo. **Volver al editor** recupera el borrador y su historial. Completar la ruta base la verifica para esa geometría, gravedad, salto, velocidad y tiempo de carrera. Un mapa sin verificar sigue disponible para descargar y jugar, con el aviso **Ruta sin verificar**. Los archivos JSON v1 anteriores se pueden seguir abriendo.

El anfitrión abre **Cargar mapa** en el lobby privado y selecciona el JSON. El mapa se comparte automáticamente con toda la sala. Desde ese mismo panel puedes editar la pista o quitarla para volver a la votación. En el editor abierto desde el lobby, **Usar en esta sala** aplica el mapa directamente.
