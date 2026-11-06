import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { COMPLETED_MESSAGE, SHARED_BROWSER_NOTICE } from '@/lib/participation'

export default function CompletedParticipation() {
  return <>
    <p>{COMPLETED_MESSAGE}</p>
    <div className="form-actions">
      <Button asChild><Link to="/observatorio">Explorar resultados</Link></Button>
      <Button asChild variant="outline"><Link to="/break?juego=2048">Jugar SAVRA 2048</Link></Button>
      <Button asChild variant="outline"><Link to="/">Volver al inicio</Link></Button>
    </div>
    <p className="shared-browser-notice">{SHARED_BROWSER_NOTICE}</p>
  </>
}
