import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  correct: boolean | null
  explanation: string
}

export function FeedbackBanner({ correct, explanation }: Props) {
  return (
    <AnimatePresence>
      {correct !== null && (
        <motion.div
          key={String(correct)}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className={`rounded border px-4 py-3 text-sm font-ui ${
            correct
              ? 'bg-[#001a0f] border-[#00ff9f] text-[#00ff9f]'
              : 'bg-[#1a0008] border-[#ff3b5c] text-[#ff3b5c]'
          }`}
          role="alert"
          aria-live="polite"
        >
          <span className="font-semibold">{correct ? '✓ CORRECT' : '✗ INCORRECT'}</span>
          {explanation && <span className="ml-3 opacity-80">{explanation}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
