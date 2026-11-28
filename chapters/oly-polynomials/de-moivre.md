# 把旋转写成能连乘的数

计算 $(1+i)^8$ 时逐次展开，实部与虚部会反复交叉。平面上 $1+i$ 的长度为 $\sqrt2$，方向角为 $\pi/4$。若能追踪连乘后的长度和方向，八次乘法或许只用两笔。把非零复数写成 $z=r(\cos\theta+i\sin\theta)$，$r=|z|$，角 $\theta$ 允许相差整圈；这叫极式。

将两份极式相乘。实部出现 $\cos\alpha\cos\beta-\sin\alpha\sin\beta$，虚部出现 $\sin\alpha\cos\beta+\cos\alpha\sin\beta$，恰是和角公式。因此长度相乘、方向角相加。归纳得到棣莫弗公式 $z^n=r^n(\cos n\theta+i\sin n\theta)$，上例给 $16$。反过来开 $n$ 次根，长度取 $r^{1/n}$，角要取 $(\theta+2k\pi)/n$，$k=0,\ldots,n-1$；只把一个角除以 $n$ 会漏解。

为什么同一对三角函数也常写作 $e^{i\theta}$？以绝对收敛的幂级数定义复指数 $\exp z=\sum_{k\ge0}z^k/k!$ 后，令 $z=i\theta$，按奇偶项分开，正好得到余弦和正弦的[泰勒展开](../calculus/taylor.md)，故 $e^{i\theta}=\cos\theta+i\sin\theta$。**这个记号把转动的相加写成指数的相乘，而极式的乘法规律已经由三角恒等式独立说明。**
