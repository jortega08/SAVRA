// Always invite to the public welcome page. Never share the current route,
// query string, survey answers, participation receipt, or browser storage.
export const SAVRA_URL = 'https://savra-wacb.onrender.com'
export const SHARE_TITLE = 'SAVRA | Tu experiencia universitaria cuenta'
export const SHARE_MESSAGE = '¿Estudias en una universidad de Colombia? Te invito a participar en SAVRA, una encuesta voluntaria sobre la experiencia académica, movilidad y permanencia estudiantil. Tu opinión cuenta.'
export const SHARE_INVITATION = `${SHARE_MESSAGE}\n\n${SAVRA_URL}`
export const WHATSAPP_URL = `https://wa.me/?text=${encodeURIComponent(SHARE_INVITATION)}`
export const SHARE_DATA: ShareData = { title: SHARE_TITLE, text: SHARE_MESSAGE, url: SAVRA_URL }
