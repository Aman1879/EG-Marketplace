import { motion, useReducedMotion } from 'framer-motion';

const AnimatedPage = ({ children, className = '' }) => {
  const reduceMotion = useReducedMotion();

  const variants = {
    initial: { opacity: 0, y: 24, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -16, scale: 0.98 }
  };

  const transition = { duration: 0.55, ease: [0.22, 1, 0.36, 1] };

  const motionProps = reduceMotion
    ? {
        initial: false,
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 1, y: 0, scale: 1 }
      }
    : {
        initial: 'initial',
        animate: 'animate',
        exit: 'exit',
        variants,
        transition
      };

  return (
    <motion.main className={`page-motion ${className}`.trim()} {...motionProps}>
      {children}
    </motion.main>
  );
};

export default AnimatedPage;
