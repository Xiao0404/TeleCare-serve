// 给定一个正整数数组array[]，找出其中连续序列最长的数组，并有序的输出结果
// 例如： int[] arrays = {3, 1, 5, 2, 6, 8, 7}, 这个数组中有两个连续序列{1, 2, 3}、{5, 6, 7, 8}，输出结果为{5, 6, 7, 8}

function solve(arr){
    const hash = new Map();
    arr.forEach(t=>{
        hash.set(t,count);
    });

    let keys = hash.keys();
    let res = [];
    let maxLen = 0;
    keys.forEach(key=>{
        let temp = [key];
        let len = 1;
        while(hash.has(key+1)){
            len++;
            key++;
            temp.push(key);
            hash.delete(key);
        }
        if(len >= maxLen) res = temp.slice();
    })
    return res;
}