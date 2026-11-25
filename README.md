# Un día con Eva

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24529835.svg)](https://doi.org/10.5281/zenodo.24529835)

*Un día con Eva* (*A Day with Eva*) es un juego educativo de tipo *point and click*
sobre la evaluación en la vida cotidiana. La persona que juega acompaña a Eva, una
estudiante universitaria, a lo largo de un día en el que tiene que establecer criterios,
comparar, valorar y tomar decisiones: elegir transporte, evaluar trabajos de su clase,
escoger menú y planear la noche. Al final, un informe resume cómo lo ha hecho.

Objetivos del juego:

- Propiciar en el estudiantado la reflexión argumentada sobre la relevancia de la
  evaluación en la realidad cotidiana.
- Trabajar y explicitar los componentes fundamentales de la evaluación: establecimiento
  de criterios, comparación, valoración y toma de decisiones.

## Jugar

- **En el navegador** (ordenador, tableta o móvil, sin instalar nada):
  <https://eva.evalfor.net/> (página del juego) · <https://eva.evalfor.net/jugar/> (directamente al juego)
- **Versión original para Java**: [`java/undiaconeva.jar`](java/undiaconeva.jar)
  (2014). Se abre con `java -jar undiaconeva.jar`; necesita Java instalado.

## Contenido del repositorio

| Ruta | Qué es |
|---|---|
| `jugar/` | Versión web: el juego original funcionando en el navegador (HTML y JavaScript) |
| `java/undiaconeva.jar` | Versión original para Java, tal como se distribuyó en 2014 |
| `index.html`, `img/`, `fonts/` | Página de presentación del juego (tipografía Baloo 2, licencia SIL OFL 1.1 en `fonts/`) |

La versión web reimplementa en JavaScript el motor eAdventure con el que se hizo el
juego y usa los mismos datos, imágenes, vídeos y sonidos que la versión Java. Las
partidas y el informe final funcionan igual que en el original.

### Usarlo sin conexión

La carpeta `jugar/` es un sitio web estático. No funciona abriendo `index.html` con doble
clic, porque el navegador no deja leer los datos del juego desde el disco; hay que servirla
desde un servidor web, aunque sea uno local. Por ejemplo, desde la carpeta del repositorio:

```
python3 -m http.server 8000
```

y abrir <http://localhost:8000/jugar/> en el navegador.

## Créditos

Según la pantalla de créditos del propio juego:

- **Dirección**: María Soledad Ibarra Sáiz y Gregorio Rodríguez Gómez (Universidad de Cádiz)
- **Idea, guion y web**: Miguel Ángel Gómez Ruiz (Universidad de Cádiz)
- **Ilustración y animación**: David Nieto Rojas ([deividart.com](http://www.deividart.com))
- **Programación**: Ángel Serrano Laguna (Grupo de Investigación e-UCM)
- **Reconocimientos (música)**: «High Speed Chase», de DJ Reset, y «Love», de The Flame ([Jamendo](https://www.jamendo.com))
- Desarrollado con [eAdventure](https://e-adventure.e-ucm.es/) (e-UCM, Universidad Complutense de Madrid)

Juego realizado en el marco del Proyecto DevalSimWeb (ALFA III (2011)-10), con la
financiación de la Unión Europea, y del Proyecto DevalS (EDU2012-31804), con la
financiación del Ministerio de Economía y Competitividad.

## Licencia

El juego se distribuye bajo la licencia
[Creative Commons Reconocimiento-CompartirIgual 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/deed.es),
como figura en sus créditos. El código del motor de la versión web (`jugar/js/`) es una
adaptación del motor eAdventure y se distribuye bajo GNU LGPL 3.0. Detalles y textos
completos en [`LICENSE.md`](LICENSE.md).

## Cómo citar

Gómez Ruiz, M. Á., Ibarra-Sáiz, M. S., Rodríguez-Gómez, G., Serrano Laguna, Á. y Nieto Rojas, D. (2014). *Un día con Eva* [Juego educativo]. Zenodo. https://doi.org/10.5281/zenodo.24529835

Este DOI apunta siempre a la última versión archivada en Zenodo. La versión 1.0 tiene su
propio DOI: [10.5281/zenodo.24529836](https://doi.org/10.5281/zenodo.24529836).

Los datos para citarlo también están en [`CITATION.cff`](CITATION.cff) (botón «Cite this
repository» de GitHub).
