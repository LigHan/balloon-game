package balloon;

import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.function.LongSupplier;
import static balloon.Json.*;

/** All economy operations and time transitions share one lock. No client multiplier is accepted. */
public final class Game {
    public static final List<String> STAMPS=List.of("Первый ветер","Облачный атлас","Солнечный луч","Выше гор","Звёздный путь","Лунная гавань");
    private final Path statePath, configPath;
    private final LongSupplier clock;
    private final SecureRandom random=new SecureRandom();
    private final boolean devMode;
    private final String fixedSeed;
    private Config config;
    private String configError="";
    private long configModified=-1;
    private final Map<String,Map<String,Object>> players=new LinkedHashMap<>();
    private final Map<String,Map<String,Object>> rounds=new LinkedHashMap<>();
    private final Map<String,String> nextScenarios=new HashMap<>();
    private long sequence;

    public Game(Path configPath,Path dataDirectory,LongSupplier clock,boolean devMode,String fixedSeed)throws IOException{
        this.configPath=configPath;this.statePath=dataDirectory.resolve("state.json");this.clock=clock;this.devMode=devMode;this.fixedSeed=fixedSeed;
        Files.createDirectories(dataDirectory);reloadConfig(true);
        if(Files.exists(statePath)){
            Map<String,Object> state=object(Json.parse(Files.readString(statePath)));
            for(Object p:(List<?>)state.get("players")){Map<String,Object> m=object(p);players.put((String)m.get("id"),m);}
            for(Object r:(List<?>)state.get("rounds")){Map<String,Object> m=object(r);rounds.put((String)m.get("id"),m);}
            sequence=((Number)state.get("sequence")).longValue();
        }
        tick();
    }
    public static String sha256(String text){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private static long lng(Map<String,Object> m,String k){return ((Number)m.get(k)).longValue();}
    private static double num(Map<String,Object> m,String k){return ((Number)m.get(k)).doubleValue();}
    private static double down(double x){return Math.floor((x+1e-10)*100)/100;}
    private static double money(long cents){return BigDecimal.valueOf(cents,2).doubleValue();}
    private static long payout(long stakeCents,double coefficient){return BigDecimal.valueOf(stakeCents).multiply(BigDecimal.valueOf(coefficient)).setScale(0,RoundingMode.DOWN).longValueExact();}
    private String token(){byte[] bytes=new byte[24];random.nextBytes(bytes);return HexFormat.of().formatHex(bytes);}
    public synchronized boolean hasPlayer(String id){return players.containsKey(id);}
    public synchronized String newPlayer(){
        String id=token();List<Integer> stamps=new ArrayList<>(Collections.nCopies(6,0));
        players.put(id,map("id",id,"name","Пилот "+(players.size()+1),"balanceCents",100000L,"points",0L,"stamps",stamps,"albums",0,"roundId",null,"lastRoundId",null,"lastTopup",0L));
        persist();return id;
    }
    public synchronized void rename(String id,String name){
        name=name.strip();if(name.isEmpty()||name.codePointCount(0,name.length())>24||name.chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException("Имя: от 1 до 24 символов");
        player(id).put("name",name);persist();
    }
    public synchronized void topup(String id){
        Map<String,Object> p=player(id);
        if(lng(p,"balanceCents")>=100000)throw new IllegalArgumentException("Пополнение доступно при балансе ниже 1 000 бонусов");
        if(clock.getAsLong()-lng(p,"lastTopup")<60000)throw new IllegalArgumentException("Следующее демопополнение — через минуту");
        p.put("balanceCents",lng(p,"balanceCents")+100000);p.put("lastTopup",clock.getAsLong());persist();
    }
    private Map<String,Object> player(String id){Map<String,Object> p=players.get(id);if(p==null)throw new IllegalArgumentException("Пилот не найден");return p;}
    public synchronized void setNextScenario(String id,String scenario){
        if(!devMode)throw new IllegalArgumentException("Сценарии доступны только при GAME_DEV_MODE=1");
        if(!Set.of("random","cashout","crash","booster").contains(scenario))throw new IllegalArgumentException("Неизвестный сценарий");
        nextScenarios.put(id,scenario);
    }
    public synchronized Map<String,Object> start(String playerId,String theme,int tier,String requestId){
        tick();
        if(requestId==null||!requestId.matches("[a-zA-Z0-9-]{8,80}"))throw new IllegalArgumentException("Нужен уникальный идентификатор запроса");
        for(Map<String,Object> old:rounds.values())if(playerId.equals(old.get("playerId"))&&requestId.equals(old.get("requestId")))return roundView(old);
        if(!Boolean.TRUE.equals(config.values().get("is_active")))throw new IllegalArgumentException("Игра временно приостановлена администратором");
        if(tier<0||tier>3)throw new IllegalArgumentException("Выберите один из четырёх вариантов ставки");
        Map<String,Object> themeConfig=config.theme(theme),p=player(playerId);
        if(p.get("roundId")!=null)throw new IllegalArgumentException("Дождитесь завершения текущего полёта");
        long stakeCents=Math.round(config.tier("stakes",tier)*100);
        if(lng(p,"balanceCents")<stakeCents)throw new IllegalArgumentException("Не хватает бонусов");
        String id=UUID.randomUUID().toString();String seed=fixedSeed.isBlank()?token():sha256(fixedSeed+":"+(sequence+1));
        double u=unit(seed,"crash");double min=num(themeConfig,"min_crash_multiplier"),max=num(themeConfig,"max_multiplier"),alpha=num(themeConfig,"alpha");
        double crash=down(Math.min(max,min/Math.pow(1-u,1/alpha)));
        List<?> weights=(List<?>)themeConfig.get("loot_weights");double sum=weights.stream().mapToDouble(x->((Number)x).doubleValue()).sum();
        double position=unit(seed,"loot")*sum;int boosterLevel=weights.size();
        for(int i=0;i<weights.size();i++){position-=((Number)weights.get(i)).doubleValue();if(position<0){boosterLevel=i+1;break;}}
        if(tier==0)boosterLevel=0;
        int reward=(int)(unit(seed,"reward")*6);String scenario=nextScenarios.getOrDefault(playerId,"random");
        if(devMode){
            if(scenario.equals("cashout"))crash=Math.min(max,4.5);
            if(scenario.equals("crash"))crash=1.12;
            if(scenario.equals("booster")){crash=Math.min(max,5.5);boosterLevel=tier==0?0:2;}
        }
        long now=clock.getAsLong();
        String proof=Json.string(map("algorithm","balloon-v1","roundId",id,"seed",seed,"theme",theme,"tier",tier,"config",config.values(),"crashBase",crash,"boosterLevel",boosterLevel,"rewardIndex",reward,"scenario",devMode?scenario:"random"));
        Map<String,Object> r=map("id",id,"playerId",playerId,"requestId",requestId,"theme",theme,"tier",tier,"stakeCents",stakeCents,"booster",config.tier("boosters",tier),"config",config.values(),"configVersion",config.version(),"startedAt",now,"crashBase",crash,"boosterLevel",boosterLevel,"boosterActivated",false,"points",0L,"highestLine",0,"cashoutMultiplier",null,"payoutCents",0L,"status","flying","rewardIndex",reward,"reward",null,"proof",proof,"commitment",sha256(proof),"baseMultiplier",1.0,"multiplier",1.0,"completedAt",null,"demoScenario",devMode?scenario:"random");
        sequence++;rounds.put(id,r);p.put("balanceCents",lng(p,"balanceCents")-stakeCents);p.put("roundId",id);
        nextScenarios.remove(playerId);persist();return roundView(r);
    }
    public static double unit(String seed,String purpose){long bits=Long.parseUnsignedLong(sha256(seed+":"+purpose).substring(0,13),16);return (bits+0.5)/4503599627370496.0;}
    public synchronized Map<String,Object> cashout(String playerId,String roundId){
        tick();Map<String,Object> r=rounds.get(roundId);
        if(r==null||!playerId.equals(r.get("playerId")))throw new IllegalArgumentException("Раунд не найден");
        if(r.get("cashoutMultiplier")!=null)return roundView(r);
        if(!r.get("status").equals("flying"))throw new IllegalArgumentException("Шар уже лопнул — забрать выигрыш нельзя");
        if(lng(r,"highestLine")<1)throw new IllegalArgumentException("Забрать можно после первого уровня");
        double coefficient=num(r,"multiplier");
        long payout=payout(lng(r,"stakeCents"),coefficient);
        r.put("cashoutMultiplier",coefficient);r.put("payoutCents",payout);r.put("cashedAt",clock.getAsLong());
        Map<String,Object> p=player(playerId);p.put("balanceCents",lng(p,"balanceCents")+payout);
        addPoints(r,Config.read(r.get("config")).integer("points_cashout_bonus"));persist();return roundView(r);
    }
    private void addPoints(Map<String,Object> r,long count){r.put("points",lng(r,"points")+count);Map<String,Object> p=player((String)r.get("playerId"));p.put("points",lng(p,"points")+count);}
    public synchronized void tick(){
        reloadConfig(false);boolean changed=false;long now=clock.getAsLong();
        for(Map<String,Object> r:rounds.values()){
            if(!r.get("status").equals("flying"))continue;
            Config cfg=Config.read(r.get("config"));String theme=(String)r.get("theme");Map<String,Object> t=cfg.theme(theme);
            double elapsed=Math.max(0,now-lng(r,"startedAt"))/1000.0;double growth=num(t,"multiplier_growth_rate"),crash=num(r,"crashBase");
            boolean crashed=elapsed>=Math.log(crash)/growth;
            double base=crashed?crash:Math.exp(growth*elapsed);List<Double> lines=cfg.boundaries(theme);
            for(int i=(int)lng(r,"highestLine");i<lines.size();i++){
                double boundary=lines.get(i);if(boundary>base||boundary>=crash)break;
                r.put("highestLine",i+1);addPoints(r,cfg.integer("points_per_line"));changed=true;
                if(i+1==lng(r,"boosterLevel")&&r.get("cashoutMultiplier")==null&&!Boolean.TRUE.equals(r.get("boosterActivated"))){
                    r.put("boosterActivated",true);addPoints(r,Math.round(cfg.tier("points_xN_bonus",(int)lng(r,"tier"))));
                }
            }
            double boost=Boolean.TRUE.equals(r.get("boosterActivated"))?num(r,"booster"):1;
            r.put("baseMultiplier",down(base));r.put("multiplier",down(base*boost));
            if(crashed){
                r.put("status","finished");r.put("completedAt",lng(r,"startedAt")+(long)Math.ceil(Math.log(crash)/growth*1000));
                Map<String,Object> p=player((String)r.get("playerId"));p.put("roundId",null);p.put("lastRoundId",r.get("id"));
                List<?> old=(List<?>)p.get("stamps");List<Integer> stamps=new ArrayList<>();for(Object n:old)stamps.add(((Number)n).intValue());
                int index=(int)lng(r,"rewardIndex");boolean isNew=stamps.get(index)==0;stamps.set(index,stamps.get(index)+1);
                boolean completed=stamps.stream().allMatch(n->n>0);
                if(completed){for(int i=0;i<6;i++)stamps.set(i,stamps.get(i)-1);p.put("albums",lng(p,"albums")+1);p.put("balanceCents",lng(p,"balanceCents")+cfg.integer("album_bonus")*100L);}
                p.put("stamps",stamps);r.put("reward",map("index",index,"name",STAMPS.get(index),"isNew",isNew,"albumCompleted",completed,"albumBonus",completed?cfg.integer("album_bonus"):0));changed=true;
            }
        }
        if(changed)persist();
    }
    public synchronized Map<String,Object> state(String id){
        tick();Map<String,Object> p=player(id);Object roundId=p.get("roundId")!=null?p.get("roundId"):p.get("lastRoundId");
        List<Map<String,Object>> history=rounds.values().stream().filter(r->r.get("status").equals("finished")).sorted(Comparator.comparingLong((Map<String,Object>r)->lng(r,"completedAt")).reversed()).limit(40).map(r->historyView(r,id)).toList();
        return map("serverTime",clock.getAsLong(),"player",playerView(p),"config",config.values(),"configVersion",config.version(),"round",roundId==null?null:roundView(rounds.get(roundId)),"history",history,"leaderboard",leaderboard(id),"devMode",devMode,"nextScenario",nextScenarios.getOrDefault(id,"random"),"stampNames",STAMPS);
    }
    private Map<String,Object> playerView(Map<String,Object> p){return map("id",sha256((String)p.get("id")).substring(0,12),"name",p.get("name"),"balance",money(lng(p,"balanceCents")),"points",p.get("points"),"stamps",p.get("stamps"),"albums",p.get("albums"));}
    private List<Map<String,Object>> leaderboard(String current){
        List<Map<String,Object>> ordered=players.values().stream().sorted(Comparator.comparingLong((Map<String,Object>p)->lng(p,"points")).reversed()).toList();
        List<Map<String,Object>> result=new ArrayList<>();int rank=0;for(Map<String,Object> p:ordered){rank++;boolean me=current.equals(p.get("id"));result.add(map("rank",rank,"name",p.get("name"),"points",p.get("points"),"me",me,"id",sha256((String)p.get("id")).substring(0,12)));}return result;
    }
    private Map<String,Object> historyView(Map<String,Object> r,String current){return map("id",r.get("id"),"name",player((String)r.get("playerId")).get("name"),"me",current.equals(r.get("playerId")),"theme",r.get("theme"),"crashMultiplier",r.get("multiplier"),"crashBase",r.get("crashBase"),"cashoutMultiplier",r.get("cashoutMultiplier"),"stake",money(lng(r,"stakeCents")),"payout",money(lng(r,"payoutCents")),"points",r.get("points"),"completedAt",r.get("completedAt"),"commitment",r.get("commitment"));}
    private Map<String,Object> roundView(Map<String,Object> r){
        Config cfg=Config.read(r.get("config"));
        Map<String,Object> out=map("id",r.get("id"),"theme",r.get("theme"),"tier",r.get("tier"),"stake",money(lng(r,"stakeCents")),"booster",r.get("booster"),"boosterLevel",r.get("boosterLevel"),"boosterActivated",r.get("boosterActivated"),"points",r.get("points"),"highestLine",r.get("highestLine"),"cashoutMultiplier",r.get("cashoutMultiplier"),"payout",money(lng(r,"payoutCents")),"status",r.get("status"),"multiplier",r.get("multiplier"),"baseMultiplier",r.get("baseMultiplier"),"startedAt",r.get("startedAt"),"commitment",r.get("commitment"),"configVersion",r.get("configVersion"),"boundaries",cfg.boundaries((String)r.get("theme")),"growthRate",cfg.theme((String)r.get("theme")).get("multiplier_growth_rate"),"pointsPerLine",cfg.integer("points_per_line"),"demoScenario",r.get("demoScenario"));
        out.put("cashoutValue",money(payout(lng(r,"stakeCents"),num(r,"multiplier"))));
        if(r.get("status").equals("finished")){
            out.put("crashBase",r.get("crashBase"));out.put("reward",r.get("reward"));out.put("proof",r.get("proof"));out.put("completedAt",r.get("completedAt"));
            int tier=(int)lng(r,"tier");boolean wouldBoost=lng(r,"boosterLevel")>0&&cfg.boundaries((String)r.get("theme")).get((int)lng(r,"boosterLevel")-1)<num(r,"crashBase");
            out.put("potentialMultiplier",down(num(r,"crashBase")*(wouldBoost?cfg.tier("boosters",tier):1)));
            out.put("potentialMaximum",money(payout(lng(r,"stakeCents"),num(out,"potentialMultiplier"))));
        }
        return out;
    }
    public synchronized Map<String,Object> proof(String id){Map<String,Object> r=rounds.get(id);if(r==null||!r.get("status").equals("finished"))throw new IllegalArgumentException("Проверка доступна после завершения раунда");return map("commitment",r.get("commitment"),"proof",r.get("proof"));}
    public synchronized Map<String,Object> admin(){reloadConfig(false);return map("config",config.values(),"version",config.version(),"error",configError,"devMode",devMode);}
    public synchronized void updateConfig(Object raw){Config next=Config.read(raw);atomicWrite(configPath,Json.string(next.values())+"\n");config=next;try{configModified=Files.getLastModifiedTime(configPath).toMillis();}catch(IOException e){throw new UncheckedIOException(e);}configError="";}
    private void reloadConfig(boolean required){
        try{long modified=Files.getLastModifiedTime(configPath).toMillis();if(modified!=configModified){Config candidate=Config.read(Json.parse(Files.readString(configPath)));config=candidate;configModified=modified;configError="";}}
        catch(Exception e){if(required)throw new IllegalArgumentException("Ошибка конфигурации: "+e.getMessage(),e);configError=e.getMessage();}
    }
    private void persist(){atomicWrite(statePath,Json.string(map("schemaVersion",1,"sequence",sequence,"players",players.values(),"rounds",rounds.values())));}
    static void atomicWrite(Path path,String content){
        try{Path temp=Files.createTempFile(path.toAbsolutePath().getParent(),".balloon-",".tmp");Files.writeString(temp,content,StandardCharsets.UTF_8);try{Files.move(temp,path,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(temp,path,StandardCopyOption.REPLACE_EXISTING);}}
        catch(IOException e){throw new UncheckedIOException("Не удалось сохранить состояние",e);}
    }
}
