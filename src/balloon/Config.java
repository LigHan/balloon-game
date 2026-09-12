package balloon;

import java.util.*;
import static balloon.Json.*;

public record Config(Map<String,Object> values, String version) {
    public static Config read(Object raw) {
        Map<String,Object> m=object(Json.parse(Json.string(raw)));
        Set<String> keys=Set.of("game_id","game_name","game_type","is_active","points_per_line","points_cashout_bonus","points_xN_bonus","stakes","boosters","album_bonus","green","red");
        if(!m.keySet().equals(keys))throw new IllegalArgumentException("Неполный или неизвестный набор параметров");
        for(String k:List.of("game_id","game_name","game_type"))if(!(m.get(k) instanceof String s)||s.isBlank()||s.length()>80)throw new IllegalArgumentException("Некорректное поле "+k);
        if(!(m.get("is_active") instanceof Boolean))throw new IllegalArgumentException("is_active: true или false");
        integer(m,"points_per_line",0,10000);integer(m,"points_cashout_bonus",0,10000);integer(m,"album_bonus",0,10000);
        array(m,"points_xN_bonus",4,0,10000,true);array(m,"stakes",4,1,10000,true);List<Double> boosters=array(m,"boosters",4,1,10,false);
        if(boosters.get(0)!=1.0)throw new IllegalArgumentException("Первый вариант должен быть без бустера: ×1");
        for(int i=1;i<4;i++)if(boosters.get(i)<=1)throw new IllegalArgumentException("Множители бустеров 2–4 должны быть больше 1");
        for(String name:List.of("green","red")){
            Map<String,Object> t=object(m.get(name));
            if(!t.keySet().equals(Set.of("levels","alpha","min_crash_multiplier","max_multiplier","multiplier_growth_rate","loot_weights")))throw new IllegalArgumentException("Неверные параметры темы "+name);
            integer(t,"levels",name.equals("green")?9:12,name.equals("green")?9:12);
            number(t,"alpha",0.2,5);double min=number(t,"min_crash_multiplier",1,10),max=number(t,"max_multiplier",2,100);
            if(min>=max)throw new IllegalArgumentException("min_crash_multiplier должен быть меньше max_multiplier");
            number(t,"multiplier_growth_rate",0.03,1);
            List<Double> weights=array(t,"loot_weights",name.equals("green")?9:12,0,100000,false);
            if(weights.stream().mapToDouble(Double::doubleValue).sum()<=0)throw new IllegalArgumentException("Сумма весов бустера должна быть положительной");
        }
        return new Config(m,Game.sha256(Json.string(m)).substring(0,12));
    }
    public static double number(Map<String,Object> m,String k,double min,double max){Object v=m.get(k);if(!(v instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()<min||n.doubleValue()>max)throw new IllegalArgumentException(k+": допустимо от "+min+" до "+max);return ((Number)v).doubleValue();}
    public static int integer(Map<String,Object> m,String k,int min,int max){double v=number(m,k,min,max);if(v!=Math.rint(v))throw new IllegalArgumentException(k+": требуется целое число");return (int)v;}
    public static List<Double> array(Map<String,Object> m,String k,int count,double min,double max,boolean ints){
        if(!(m.get(k) instanceof List<?> l)||l.size()!=count)throw new IllegalArgumentException(k+": требуется "+count+" значений");
        List<Double> a=new ArrayList<>();for(Object o:l){if(!(o instanceof Number n))throw new IllegalArgumentException(k+": нужны числа");double v=n.doubleValue();if(!Double.isFinite(v)||v<min||v>max||(ints&&v!=Math.rint(v)))throw new IllegalArgumentException("Недопустимое значение "+k);a.add(v);}return a;
    }
    public int integer(String key){return ((Number)values.get(key)).intValue();}
    public double tier(String key,int tier){return ((Number)((List<?>)values.get(key)).get(tier)).doubleValue();}
    public Map<String,Object> theme(String name){if(!name.equals("green")&&!name.equals("red"))throw new IllegalArgumentException("Неизвестная тема");return object(values.get(name));}
    public List<Double> boundaries(String theme){Map<String,Object> t=theme(theme);int n=((Number)t.get("levels")).intValue();double max=((Number)t.get("max_multiplier")).doubleValue();List<Double> lines=new ArrayList<>();for(int i=1;i<=n;i++)lines.add(Math.pow(max,(double)i/(n+1)));return lines;}
}
