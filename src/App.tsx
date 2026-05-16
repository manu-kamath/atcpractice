import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Placeholder } from './pages/Placeholder'
import { BigNumbers } from './modules/BigNumbers'
import { CoordinateSystem } from './modules/CoordinateSystem'
import { CubeFolding } from './modules/CubeFolding'
import { DividedAttention } from './modules/DividedAttention'
import { HeadingConflicts } from './modules/HeadingConflicts'
import { LearningRules } from './modules/LearningRules'
import { MatchingFigure } from './modules/MatchingFigure'
import { MemorizeInstruments } from './modules/MemorizeInstruments'
import { MemorizePictograms } from './modules/MemorizePictograms'
import { MultiAttention } from './modules/MultiAttention'
import { PlanningAbility } from './modules/PlanningAbility'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Module routes */}
        <Route path="/modules/big-numbers" element={<BigNumbers />} />
        <Route path="/modules/coordinate-system" element={<CoordinateSystem />} />
        <Route path="/modules/cube-folding" element={<CubeFolding />} />
        <Route path="/modules/divided-attention" element={<DividedAttention />} />
        <Route path="/modules/heading-conflicts" element={<HeadingConflicts />} />
        <Route path="/modules/learning-rules" element={<LearningRules />} />
        <Route path="/modules/matching-figure" element={<MatchingFigure />} />
        <Route path="/modules/memorize-instruments" element={<MemorizeInstruments />} />
        <Route path="/modules/memorize-pictograms" element={<MemorizePictograms />} />
        <Route path="/modules/multi-attention" element={<MultiAttention />} />
        <Route path="/modules/planning-ability" element={<PlanningAbility />} />
        <Route path="/modules/spot-the-side" element={<Placeholder moduleId={12} />} />
        <Route path="/modules/vigilance" element={<Placeholder moduleId={13} />} />
        <Route path="/modules/dart" element={<Placeholder moduleId={14} />} />
        <Route path="/modules/multi-control" element={<Placeholder moduleId={15} />} />
        <Route path="/modules/radar-control" element={<Placeholder moduleId={16} />} />
        <Route path="/modules/strip-display" element={<Placeholder moduleId={17} />} />
      </Routes>
    </BrowserRouter>
  )
}
