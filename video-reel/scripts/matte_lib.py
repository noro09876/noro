"""Person matte via MediaPipe selfie-multiclass TFLite model (run with LiteRT)."""
import numpy as np, cv2
from ai_edge_litert.interpreter import Interpreter

class Matter:
    def __init__(self, model_path):
        self.it = Interpreter(model_path, num_threads=4)
        self.it.allocate_tensors()
        self.i = self.it.get_input_details()[0]["index"]
        self.o = self.it.get_output_details()[0]["index"]

    def _run(self, rgb):
        x = cv2.resize(rgb, (256, 256), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        self.it.set_tensor(self.i, x[None])
        self.it.invoke()
        y = self.it.get_tensor(self.o)[0]
        if y.min() < 0 or y.max() > 1.001:  # logits -> softmax
            e = np.exp(y - y.max(-1, keepdims=True)); y = e / e.sum(-1, keepdims=True)
        return 1.0 - y[..., 0]

    def matte(self, bgr):
        """bgr: HxWx3 uint8 (1080x1920). returns float32 alpha HxW in 0..1"""
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        a = cv2.resize(self._run(rgb), (w, h), interpolation=cv2.INTER_CUBIC)
        # second pass on square tiles for sharper edges, blended with the global pass
        acc = np.zeros((h, w), np.float32); wsum = np.zeros((h, w), np.float32)
        ys = [0, (h - w) // 2, h - w]
        ramp = np.clip(np.minimum(np.arange(w), np.arange(w)[::-1]) / 120.0, 0.05, 1).astype(np.float32)
        wy = np.repeat(ramp[:, None], w, 1)
        for y0 in ys:
            t = cv2.resize(self._run(rgb[y0:y0 + w]), (w, w), interpolation=cv2.INTER_CUBIC)
            acc[y0:y0 + w] += t * wy; wsum[y0:y0 + w] += wy
        t = acc / np.maximum(wsum, 1e-3)
        a = np.clip(0.35 * a + 0.65 * t, 0, 1)
        g = cv2.ximgproc.guidedFilter(bgr, a, 10, 1e-4 * 255 * 255)
        return np.clip((g - 0.5) * 2.4 + 0.5, 0, 1)
