# 一天跨过几次整点？

两个时段各占 $x,y$ 个小时，只记录每段中完整小时的数量，合起来是否等于总时段的完整小时数？$0.7+0.8$ 提醒我们，两个碎片也许足以凑出一个新小时。把 $x$ 写成整数和碎片 $\lfloor x\rfloor+\{x\}$。其中下取整 $\lfloor x\rfloor$ 是不超过 $x$ 的最大整数，分数部分 $\{x\}=x-\lfloor x\rfloor$ 总在 $[0,1)$。因而 $\lfloor x+y\rfloor-\lfloor x\rfloor-\lfloor y\rfloor$ 只可能是零或一，是否进位就看两碎片之和是否达到一。

负数也得按同一定义走。$\lfloor-0.3\rfloor=-1$，碎片为 $0.7$。向上取整 $\lceil x\rceil$ 是不小于 $x$ 的最小整数，满足 $\lceil x\rceil=-\lfloor-x\rfloor$。

例如解 $\lfloor2x\rfloor=3$，把符号还原为两道门槛 $3\le2x<4$，得 $3/2\le x<2$。再如在 $[0,2)$ 上求 $\lfloor x\rfloor+\lfloor2x\rfloor$，只需在 $0,1/2,1,3/2$ 处分段，各段的值依次为 $0,1,3,4$。**分段点由输入何时碰到整数决定，开闭端点决定整点那一刻算在哪段。**
