import { Link } from 'react-router-dom'
import { ArrowUpRight, ChartNoAxesColumnIncreasing, UserRound } from 'lucide-react'
import { Brand } from '@/components/shared'
import ShareSavra from '@/components/ShareSavra'
import { Button } from '@/components/ui/button'
import { COMPLETED_MESSAGE, useCompletedParticipation } from '@/lib/participation'

export default function Welcome({ demo = false }: { demo?: boolean }) {
  const { completed, error, check } = useCompletedParticipation(!demo)
  return <main className="welcome">
    <header className="welcome-header"><Brand compact /><p>Plataforma de analítica académica</p></header>
    <section className="welcome-content" aria-labelledby="welcome-title">
      <h1 id="welcome-title"><strong>Entender para</strong><br /><span>transformar.</span></h1>
      <p className="welcome-description">{demo ? 'Explora cómo SAVRA analiza condiciones académicas y de movilidad con un conjunto de datos simulados.' : 'Conecta experiencias estudiantiles con información que permite comprender los desafíos de la permanencia universitaria.'}</p>
      <div className="role-grid">
        {demo ? <article className="role-card"><div className="role-icon"><ChartNoAxesColumnIncreasing strokeWidth={1.6} /></div><h2>Demostración técnica</h2><p>Explora distribuciones, filtros y comparaciones con registros sintéticos.</p><Button asChild><Link to="/observatorio">Explorar datos simulados</Link></Button></article> : <>
        <article className="role-card"><div className="role-icon student"><UserRound strokeWidth={1.6} /></div><h2>Soy estudiante</h2><p>{completed ? COMPLETED_MESSAGE : 'Comparte tu experiencia y ayúdanos a comprender los factores de la permanencia.'}</p>{completed ? <Button variant="outline" asChild><Link to="/gracias">Participación completada</Link></Button> : error ? <><p role="alert">{error}</p><Button variant="outline" onClick={check}>Reintentar verificación</Button></> : completed === undefined ? <Button disabled>Verificando participación…</Button> : <Button asChild><Link to="/consentimiento">Responder encuesta</Link></Button>}</article>
        <article className="role-card"><div className="role-icon"><ChartNoAxesColumnIncreasing strokeWidth={1.6} /></div><h2>Solo quiero ver</h2><p>Explora resultados agregados sobre la experiencia y la continuidad universitaria.</p><Button variant="outline" asChild><Link to="/observatorio">Explorar resultados</Link></Button></article>
        </>}
      </div>
      <Link className="welcome-break-link" to="/break">SAVRA Break <ArrowUpRight aria-hidden="true" size={15} /></Link>
      {!demo && <ShareSavra />}
    </section>
  </main>
}
